#!/usr/bin/env python3
"""KAIRO's code runner for Vercel Sandbox: the Docker runner, without Docker.

On Vercel there is no Docker daemon to start containers, so the API sends each
job to a Vercel Sandbox (a Firecracker micro-VM) started from a snapshot that
holds the very same sandbox images, exported as plain root filesystems
(see build-snapshot.sh). This program runs one job there, as root:

    python3 -I -S kairo_exec.py run /path/to/job.json

and prints the runner's NDJSON wire protocol on stdout (step_started,
step_finished, then job_finished with the JobResult): the same contract as
POST /v1/jobs of services/runner, so the API interprets results identically.

Every step gets what the Docker runner gives a container (services/runner/runner/sandbox.py):

  Docker runner                          here
  -------------------------------------  ------------------------------------------------
  network_mode=none                      new network namespace (loopback only)
  read-only root filesystem              the image's rootfs bind-mounted read-only, pivot_root
  /tmp tmpfs (size, nosuid,nodev,noexec) the same tmpfs
  /workspace volume, rw or ro per step   the job's directory bind-mounted rw or ro
  non-root UID/GID 10001                 setuid/setgid 10001, no supplementary groups
  cap_drop ALL + no-new-privileges       capabilities lost with the UID; PR_SET_NO_NEW_PRIVS
  default seccomp profile                a seccomp filter refusing the kernel's riskiest calls
  mem_limit = memswap_limit              cgroup v2 memory.max, memory.swap.max = 0
  pids_limit, nano_cpus                  cgroup v2 pids.max, cpu.max (one CPU)
  OOMKilled                              memory.events oom_kill of the step's cgroup
  RLIMIT_CPU/FSIZE/CORE/NOFILE           the same rlimits
  tini as PID 1 (init=True)              a PID namespace whose init reaps and reports
                                         "killed by signal N" as 128+N, like tini
  own hostname, IPC, /dev, masked /proc  UTS/IPC namespaces, minimal /dev, masked /proc

Argument arrays only: nothing from a job is ever passed through a shell.
Standard library only, so it runs on the VM's own Python.
"""

from __future__ import annotations

import ctypes
import errno
import fcntl
import json
import os
import re
import resource
import secrets
import selectors
import shutil
import signal
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path

IMAGES = Path("/opt/kairo/images")        # sandbox-<name>/rootfs + config.json, and manifest.json
JOBS = Path("/var/lib/kairo/jobs")        # per-job workspace and mount points (root only)
ETC = Path("/opt/kairo/etc")              # hosts / hostname files bind-mounted into every step
CGROOT = Path("/sys/fs/cgroup")
CGINIT = CGROOT / "kairo-init"            # processes that were already running move here
CGSTEPS = CGROOT / "kairo"                # one child cgroup per running step
STATE = Path("/run/kairo")                # per-boot state: slot locks, set-up markers

UID = GID = 10001                         # the "sandbox" user baked into every image
HOSTNAME = "sandbox"
BASE_ENV = {                              # the Docker runner's BASE_ENV
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "HOME": "/tmp",
    "LANG": "C.UTF-8",
}
MB = 1024 * 1024
SETUP_GRACE_S = 0.3        # namespace set-up is not charged to the program (Docker: start-up)
SLOT_WAIT_S = 20.0         # how long a job waits for a free slot before answering "busy"
STALE_S = 180              # a step cannot live this long (60 s ceiling); anything older is debris

# The production runner's ceilings (services/runner/runner/config.py): a job may ask for less, never more.
CEILINGS = {
    "wallTimeMs": 60_000, "cpuTimeS": 60, "memoryMb": 1024, "pids": 256,
    "outputKb": 1024, "tmpMb": 256, "fileSizeMb": 128,
}
FLOORS = {"wallTimeMs": 100, "cpuTimeS": 1, "memoryMb": 16, "pids": 4, "outputKb": 1, "tmpMb": 1, "fileSizeMb": 1}
MAX_STEPS, MAX_FILES = 4, 16
MAX_SOURCE_BYTES, MAX_STDIN_BYTES = 256 * 1024, 64 * 1024
_SAFE_FILE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$")
_STEP_NAME = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
_JOB_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_DENIED_ENV = re.compile(r"^(?:LD_|DYLD_)")
_WORKDIRS = {"/workspace", "/tmp"}

# Linux constants the os module does not expose.
MS_RDONLY, MS_NOSUID, MS_NODEV, MS_NOEXEC = 1, 2, 4, 8
MS_REMOUNT, MS_BIND, MS_REC = 32, 4096, 16384
MNT_DETACH = 2
PR_SET_PDEATHSIG, PR_SET_NO_NEW_PRIVS, PR_SET_SECCOMP = 1, 38, 22
SECCOMP_MODE_FILTER = 2
SIOCGIFFLAGS, SIOCSIFFLAGS, IFF_UP = 0x8913, 0x8914, 0x1
SYS_PIVOT_ROOT = 155       # x86_64 (the sandbox is created as amd64)

_libc = ctypes.CDLL(None, use_errno=True)
_libc.mount.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_ulong, ctypes.c_char_p]
_libc.umount2.argtypes = [ctypes.c_char_p, ctypes.c_int]
_libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]

# Seccomp: system calls a student's program never needs and that have a history of kernel bugs
# (Docker's default profile refuses these too). They fail with EPERM, as under Docker.
_DENY_X86_64 = (
    250, 248, 249,            # keyctl, add_key, request_key
    298, 321, 323,            # perf_event_open, bpf, userfaultfd
    425, 426, 427,            # io_uring_setup / enter / register
    246, 320, 175, 313, 176,  # kexec_load, kexec_file_load, init_module, finit_module, delete_module
    304, 303, 272, 308,       # open_by_handle_at, name_to_handle_at, unshare, setns
    165, 166, 155, 161,       # mount, umount2, pivot_root, chroot
    428, 429, 430, 431, 432, 433, 442, 457, 458,  # new mount API, statmount, listmount
    167, 168, 169, 163, 179, 443, 212,            # swapon, swapoff, reboot, acct, quotactl(_fd), lookup_dcookie
    172, 173, 154, 103, 134, 153, 180,            # iopl, ioperm, modify_ldt, syslog, uselib, vhangup, nfsservctl
    164, 227, 159, 305, 300,                      # settimeofday, clock_settime, adjtimex, clock_adjtime, fanotify_init
)
_DENY_I386 = (                # the same calls through the 32-bit entry point (int 0x80)
    288, 286, 287, 336, 357, 374, 425, 426, 427, 283, 128, 350, 129,
    342, 341, 310, 346, 21, 22, 52, 217, 61, 428, 429, 430, 431, 432, 433, 442, 457, 458,
    87, 115, 88, 51, 131, 443, 253, 110, 101, 123, 166, 113, 103, 86, 111, 169,
    79, 25, 264, 404, 124, 343, 405, 338,
)
AUDIT_ARCH_X86_64, AUDIT_ARCH_I386 = 0xC000003E, 0x40000003
X32_SYSCALL_BIT = 0x40000000


class PolicyViolation(ValueError):
    pass


class Busy(Exception):
    pass


def emit(event: dict) -> None:
    sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    sys.stdout.flush()


# ------------------------------------------------------------------ policy


def check_job(job: dict, manifest: dict) -> None:
    """The runner's policy (services/runner/runner/policy.py and jobspec.py), re-checked here."""
    problems: list[str] = []
    if not isinstance(job.get("jobId"), str) or not _JOB_ID.match(job["jobId"]):
        problems.append("invalid jobId")
    if job.get("image") not in manifest:
        problems.append(f"image {job.get('image')!r} is not in the runner allow-list")
    files = job.get("files")
    if not isinstance(files, list) or not files or len(files) > MAX_FILES:
        problems.append(f"a job needs 1 to {MAX_FILES} files")
        files = []
    total, seen = 0, set()
    for f in files:
        path, content = (f.get("path"), f.get("content")) if isinstance(f, dict) else (None, None)
        if not isinstance(path, str) or not _SAFE_FILE.match(path) or path in {".", ".."}:
            problems.append(f"unsafe file name {path!r}")
        elif path in seen:
            problems.append(f"duplicate file name {path!r}")
        seen.add(path)
        if not isinstance(content, str):
            problems.append(f"file {path!r} has no text content")
        else:
            total += len(content.encode("utf-8"))
    if total > MAX_SOURCE_BYTES:
        problems.append(f"source too large ({total} bytes > {MAX_SOURCE_BYTES})")
    steps = job.get("steps")
    if not isinstance(steps, list) or not steps or len(steps) > MAX_STEPS:
        problems.append(f"a job needs 1 to {MAX_STEPS} steps")
        steps = []
    names: set[str] = set()
    for step in steps:
        if not isinstance(step, dict):
            problems.append("invalid step")
            continue
        name = step.get("name")
        where = f"step {name!r}"
        if not isinstance(name, str) or not _STEP_NAME.match(name):
            problems.append(f"invalid {where}")
        elif name in names:
            problems.append(f"duplicate {where}")
        names.add(name)
        argv = step.get("argv")
        if not isinstance(argv, list) or not 1 <= len(argv) <= 64 or not all(isinstance(a, str) for a in argv):
            problems.append(f"{where}: argv must be 1 to 64 strings")
        elif any("\x00" in a for a in argv) or not argv[0]:
            problems.append(f"{where}: invalid argv")
        if step.get("workdir", "/workspace") not in _WORKDIRS:
            problems.append(f"{where}: workdir must be one of {sorted(_WORKDIRS)}")
        if step.get("workspaceMode", "rw") not in ("rw", "ro"):
            problems.append(f"{where}: workspaceMode must be rw or ro")
        env = step.get("env") or {}
        if not isinstance(env, dict):
            problems.append(f"{where}: env must be an object")
            env = {}
        for key, value in env.items():
            if not isinstance(key, str) or not _ENV_KEY.match(key) or not isinstance(value, str) or "\x00" in value:
                problems.append(f"{where}: invalid environment variable {key!r}")
            elif _DENIED_ENV.match(key):
                problems.append(f"{where}: environment variable {key!r} is not allowed")
        stdin = step.get("stdin")
        if stdin is not None and (not isinstance(stdin, str) or len(stdin.encode("utf-8")) > MAX_STDIN_BYTES):
            problems.append(f"{where}: stdin larger than {MAX_STDIN_BYTES} bytes")
        limits = step.get("limits")
        if not isinstance(limits, dict):
            problems.append(f"{where}: limits are missing")
            continue
        for field, ceiling in CEILINGS.items():
            value = limits.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value < FLOORS[field]:
                problems.append(f"{where}: {field} is missing or too small")
            elif value > ceiling:
                problems.append(f"{where}: {field}={value} exceeds ceiling {ceiling}")
    if problems:
        raise PolicyViolation("; ".join(problems))


# ------------------------------------------------------------------ once per boot


def harden() -> None:
    """Shrink the kernel attack surface for unprivileged code."""
    marker = STATE / "hardened"
    if marker.exists():
        return
    settings = {
        "user/max_user_namespaces": "0",          # no user namespaces for anyone
        "kernel/unprivileged_bpf_disabled": "1",
        "kernel/perf_event_paranoid": "3",
        "kernel/kptr_restrict": "2",
        "kernel/dmesg_restrict": "1",
        "vm/unprivileged_userfaultfd": "0",
        "kernel/io_uring_disabled": "2",
    }
    for key, value in settings.items():
        try:
            Path("/proc/sys", key).write_text(value)
        except OSError:
            pass  # not every kernel has every knob; seccomp refuses the same calls anyway
    STATE.mkdir(parents=True, exist_ok=True)
    marker.write_text("1")


def setup_cgroups() -> None:
    """Real cgroup v2 limits for steps (memory, pids, cpu), as Docker gives each container.

    A cgroup that hands domain controllers such as memory to its children may not
    hold processes itself, so everything already running moves to a leaf first.
    The root must also be a plain "domain" cgroup: threaded controllers enabled
    while it held processes (a Docker daemon does that) are switched off first.
    """
    marker = STATE / "cgroups"
    if marker.exists():
        return
    STATE.mkdir(parents=True, exist_ok=True)
    with open(STATE / "cgroups.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if marker.exists():
            return
        wanted = ("memory", "pids", "cpu")
        available = (CGROOT / "cgroup.controllers").read_text().split()
        missing = [c for c in wanted if c not in available]
        if missing:
            raise RuntimeError(f"cgroup controllers {missing} are not available")
        # Empty leftovers (a removed Docker daemon's groups, an earlier attempt) go first.
        for group in sorted((p for p in CGROOT.rglob("*") if p.is_dir()), key=lambda p: -len(p.parts)):
            try:
                group.rmdir()
            except OSError:
                pass
        enabled = (CGROOT / "cgroup.subtree_control").read_text().split()
        if (CGROOT / "cgroup.type").read_text().strip() != "domain" and enabled:
            (CGROOT / "cgroup.subtree_control").write_text(" ".join(f"-{c}" for c in enabled))
        if (CGROOT / "cgroup.type").read_text().strip() != "domain":
            raise RuntimeError("the root cgroup is not a domain cgroup")
        enable = " ".join(f"+{c}" for c in wanted)
        CGINIT.mkdir(exist_ok=True)
        for _ in range(200):
            for pid in (CGROOT / "cgroup.procs").read_text().split():
                try:
                    (CGINIT / "cgroup.procs").write_text(pid)
                except OSError as exc:
                    if exc.errno not in (errno.ESRCH, errno.EINVAL):
                        raise
            try:
                (CGROOT / "cgroup.subtree_control").write_text(enable)
                break
            except OSError as exc:
                if exc.errno != errno.EBUSY:
                    raise
                time.sleep(0.01)  # a process appeared meanwhile: move it too
        else:
            raise RuntimeError("could not enable the memory controller")
        CGSTEPS.mkdir(exist_ok=True)
        (CGSTEPS / "cgroup.subtree_control").write_text(enable)
        marker.write_text("1")


def remove_stale() -> None:
    """Steps and workspaces left behind by an executor that was killed mid-job.

    Both are named "<unix time>-<job id>-<random>[-<step>]", so their age is in the name.
    """
    now = time.time()

    def stale(path: Path) -> bool:
        head = path.name.split("-", 1)[0]
        return head.isdigit() and now - int(head) > STALE_S

    for parent, remove in ((CGSTEPS, remove_cgroup), (JOBS, lambda d: shutil.rmtree(d, ignore_errors=True))):
        try:
            entries = [p for p in parent.iterdir() if p.is_dir()]
        except OSError:
            continue
        for entry in entries:
            if stale(entry):
                remove(entry)


# ------------------------------------------------------------------ per job


def slot_count() -> int:
    try:
        return max(1, int((STATE / "slots").read_text()))
    except (OSError, ValueError):
        return max(os.cpu_count() or 1, 2)


def acquire_slot() -> int:
    """At most slot_count() steps run at once on this VM; the others wait, then get "busy"."""
    slots = STATE / "slots.d"
    slots.mkdir(parents=True, exist_ok=True)
    count = slot_count()
    deadline = time.monotonic() + SLOT_WAIT_S
    while True:
        for n in range(count):
            fd = os.open(slots / f"slot-{n}", os.O_CREAT | os.O_RDWR, 0o600)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return fd
            except BlockingIOError:
                os.close(fd)
        if time.monotonic() > deadline:
            raise Busy()
        time.sleep(0.1)


def make_cgroup(name: str, lim: dict) -> Path:
    cg = CGSTEPS / name
    cg.mkdir()
    (cg / "memory.max").write_text(str(lim["memoryMb"] * MB))
    if (cg / "memory.swap.max").exists():
        (cg / "memory.swap.max").write_text("0")
    (cg / "pids.max").write_text(str(lim["pids"]))
    (cg / "cpu.max").write_text("100000 100000")  # one CPU, like nano_cpus = 1e9
    return cg


def cgroup_value(cg: Path, filename: str, key: str | None = None) -> int:
    try:
        text = (cg / filename).read_text()
    except OSError:
        return 0
    if key is None:
        return int(text.split()[0]) if text.split() else 0
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] == key:
            return int(parts[1])
    return 0


def kill_cgroup(cg: Path) -> None:
    try:
        (cg / "cgroup.kill").write_text("1")
    except OSError:
        pass


def remove_cgroup(cg: Path) -> None:
    kill_cgroup(cg)
    for _ in range(250):
        try:
            cg.rmdir()
            return
        except FileNotFoundError:
            return
        except OSError:
            time.sleep(0.02)


def load_image(name: str, manifest: dict) -> tuple[Path, dict, dict | None]:
    base = IMAGES / manifest[name]
    config = json.loads((base / "config.json").read_text())
    toolchain = None
    try:  # same rule as the Docker runner: a malformed file means "version unknown"
        info = json.loads((base / "rootfs/etc/compiler-copilot/toolchain.json").read_text())
        if (isinstance(info, dict) and set(info) <= {"name", "version", "languages"}
                and isinstance(info.get("name"), str) and isinstance(info.get("version"), str)
                and all(isinstance(x, str) for x in info.get("languages", []))):
            toolchain = {"name": info["name"], "version": info["version"],
                         "languages": list(info.get("languages", []))}
    except (OSError, ValueError):
        pass
    return base, config, toolchain


def step_env(image_env: list[str], step: dict) -> dict[str, str]:
    """Image ENV, then the runner's base environment, then the step's own (as Docker merges them)."""
    env: dict[str, str] = {}
    for item in image_env:
        key, _, value = item.partition("=")
        env[key] = value
    env.update(BASE_ENV)
    env["HOSTNAME"] = HOSTNAME
    env.update(step.get("env") or {})
    return env


def _die_with_parent() -> None:  # runs in the child between fork and exec
    _libc.prctl(PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0)


def run_step(job_dir: Path, rootfs: Path, image_env: list[str], step: dict, index: int) -> dict:
    lim = step["limits"]
    cg = make_cgroup(f"{job_dir.name}-{index}", lim)
    stage = {
        "root": str(job_dir / f"root-{index}"),
        "rootfs": str(rootfs),
        "workspace": str(job_dir / "workspace"),
        "workspaceMode": step.get("workspaceMode", "rw"),
        "workdir": step.get("workdir", "/workspace"),
        "argv": step["argv"],
        "env": step_env(image_env, step),
        "tmpMb": lim["tmpMb"],
        "cpuTimeS": lim["cpuTimeS"],
        "fileSizeMb": lim["fileSizeMb"],
        "cgroup": str(cg),
    }
    Path(stage["root"]).mkdir(mode=0o755)
    stage_file = job_dir / f"stage-{index}.json"
    stage_file.write_text(json.dumps(stage))

    command = ["/usr/bin/unshare", "--fork", "--kill-child", "--pid", "--mount", "--net", "--ipc",
               "--uts", "--propagation", "private",
               sys.executable, "-I", "-S", os.path.abspath(__file__), "stage", str(stage_file)]
    cap = lim["outputKb"] * 1024
    out, err = bytearray(), bytearray()
    out_cut = err_cut = False
    stop_reason: str | None = None
    stdin_data = (step.get("stdin") or "").encode("utf-8")

    started = time.monotonic()
    proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            preexec_fn=_die_with_parent, close_fds=True)
    deadline = started + SETUP_GRACE_S + lim["wallTimeMs"] / 1000

    def kill() -> None:
        kill_cgroup(cg)          # the program and everything it started
        try:
            proc.kill()          # unshare --kill-child takes the namespace's init with it
        except ProcessLookupError:
            pass

    sel = selectors.DefaultSelector()
    for stream in (proc.stdout, proc.stderr):
        os.set_blocking(stream.fileno(), False)
        sel.register(stream, selectors.EVENT_READ)
    if stdin_data:
        os.set_blocking(proc.stdin.fileno(), False)
        sel.register(proc.stdin, selectors.EVENT_WRITE)
    else:
        proc.stdin.close()  # end of file straight away, like the Docker runner's half-close
    sent = 0
    open_streams = 2
    while open_streams > 0:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            stop_reason = "TIMEOUT"
            kill()
            break
        for key, _ in sel.select(timeout=min(remaining, 0.25)):
            stream = key.fileobj
            if stream is proc.stdin:
                try:
                    sent += os.write(proc.stdin.fileno(), stdin_data[sent:sent + 65536])
                except BlockingIOError:
                    continue
                except BrokenPipeError:
                    sent = len(stdin_data)  # the program exited without reading all of its input
                if sent >= len(stdin_data):
                    sel.unregister(proc.stdin)
                    proc.stdin.close()
                continue
            try:
                chunk = os.read(stream.fileno(), 65536)
            except BlockingIOError:
                continue
            if not chunk:
                sel.unregister(stream)
                open_streams -= 1
                continue
            buf = out if stream is proc.stdout else err
            room = cap - len(buf)
            if len(chunk) > room:
                buf += chunk[:max(room, 0)]
                if stream is proc.stdout:
                    out_cut = True
                else:
                    err_cut = True
                stop_reason = "OUTPUT_LIMIT"
                kill()
                open_streams = 0
                break
            buf += chunk

    # Output can end before the process does (it may close both streams and keep running),
    # so the wall-clock limit applies here too.
    try:
        proc.wait(timeout=max(deadline - time.monotonic(), 0) + 2.0)
    except subprocess.TimeoutExpired:
        stop_reason = stop_reason or "TIMEOUT"
        kill()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
    wall_ms = int((time.monotonic() - started) * 1000)
    exit_code: int | None = None
    if proc.returncode is not None:
        exit_code = proc.returncode if proc.returncode >= 0 else 128 - proc.returncode
    sel.close()
    for stream in (proc.stdin, proc.stdout, proc.stderr):
        try:
            stream.close()
        except (OSError, ValueError):
            pass

    oom = cgroup_value(cg, "memory.events", "oom_kill") > 0
    peak = cgroup_value(cg, "memory.peak") or None
    remove_cgroup(cg)
    shutil.rmtree(Path(stage["root"]), ignore_errors=True)
    stage_file.unlink(missing_ok=True)

    # Exactly the Docker runner's classification (_step_result).
    sig: int | None = None
    if stop_reason is not None:
        termination = stop_reason
    elif oom:
        termination = "MEMORY_LIMIT"
    elif exit_code is None:
        termination = "INTERNAL_ERROR"
    elif 128 < exit_code <= 128 + 64:
        sig = exit_code - 128  # the namespace's init reports "killed by signal N" as 128+N, like tini
        termination = "TIMEOUT" if sig == signal.SIGXCPU else "SIGNALED"
    else:
        termination = "EXITED"
    return {
        "name": step["name"], "termination": termination, "exitCode": exit_code, "signal": sig,
        "durationMs": wall_ms, "wallMs": wall_ms,
        "stdout": out.decode("utf-8", errors="replace"), "stderr": err.decode("utf-8", errors="replace"),
        "stdoutTruncated": out_cut, "stderrTruncated": err_cut,
        "oomKilled": oom, "peakMemoryBytes": peak,
    }


def run_job(job_path: Path) -> int:
    job_id, image = "unknown", ""
    try:
        job = json.loads(job_path.read_text())
        if not isinstance(job, dict):
            raise ValueError("not an object")
        job_id, image = str(job.get("jobId", "unknown"))[:64], str(job.get("image", ""))[:200]
    except (OSError, ValueError) as exc:
        emit({"type": "job_finished", "jobId": job_id,
              "result": _failed(job_id, image, f"runner error: unreadable job ({exc})")})
        return 0
    finally:
        try:
            job_path.unlink()
        except OSError:
            pass
    try:
        manifest = json.loads((IMAGES / "manifest.json").read_text())
        check_job(job, manifest)
    except PolicyViolation as exc:
        emit({"type": "job_finished", "jobId": job_id, "result": _failed(job_id, image, f"policy violation: {exc}")})
        return 0
    try:
        harden()
        setup_cgroups()
        remove_stale()
        slot = acquire_slot()
    except Busy:
        emit({"type": "busy", "jobId": job_id, "retryAfterS": 2})
        return 75
    except Exception as exc:  # noqa: BLE001 - never run without limits
        emit({"type": "job_finished", "jobId": job_id, "result": _failed(job_id, image, f"runner error: {exc}")})
        return 0
    job_dir = JOBS / f"{int(time.time())}-{job_id}-{secrets.token_hex(4)}"
    steps: list[dict] = []
    toolchain, image_id = None, ""
    try:
        base, config, toolchain = load_image(image, manifest)
        image_id = str(config.get("id", ""))
        JOBS.mkdir(parents=True, exist_ok=True)
        os.chmod(JOBS, 0o700)
        job_dir.mkdir(mode=0o700)
        workspace = job_dir / "workspace"
        workspace.mkdir(mode=0o755)
        os.chown(workspace, UID, GID)
        for f in job["files"]:
            target = workspace / f["path"]
            target.write_text(f["content"], encoding="utf-8")
            os.chown(target, UID, GID)
            os.chmod(target, 0o644)
        for index, step in enumerate(job["steps"]):
            emit({"type": "step_started", "jobId": job_id, "step": step["name"]})
            result = run_step(job_dir, base / "rootfs", config.get("env", []), step, index)
            steps.append(result)
            emit({"type": "step_finished", "jobId": job_id, "step": step["name"],
                  "termination": result["termination"], "exitCode": result["exitCode"]})
            if result["termination"] != "EXITED" or result["exitCode"] != 0:
                break
        result = {"jobId": job_id, "image": image, "imageId": image_id, "toolchain": toolchain,
                  "steps": steps, "error": None}
    except Exception as exc:  # noqa: BLE001 - report, never leave the API without an answer
        result = {"jobId": job_id, "image": image, "imageId": image_id, "toolchain": toolchain,
                  "steps": steps, "error": f"runner error: {exc}"}
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)
        os.close(slot)
    emit({"type": "job_finished", "jobId": job_id, "result": result})
    return 0


def _failed(job_id: str, image: str, error: str) -> dict:
    return {"jobId": job_id, "image": image, "imageId": "", "toolchain": None, "steps": [], "error": error}


def health() -> int:
    """The runner's GET /v1/health: which images this VM can run."""
    images: dict[str, str] = {}
    try:
        manifest = json.loads((IMAGES / "manifest.json").read_text())
        for name in manifest:
            try:
                images[name] = load_image(name, manifest)[1].get("id", "")
            except (OSError, ValueError):
                images[name] = ""
    except (OSError, ValueError):
        pass
    emit({"status": "ok" if images else "degraded", "images": images, "slots": slot_count()})
    return 0


# ------------------------------------------------------------------ inside the namespaces


def _mount(source: str | None, target: str, fstype: str | None, flags: int, data: str | None = None) -> None:
    if _libc.mount(source.encode() if source else None, target.encode(),
                   fstype.encode() if fstype else None, flags, data.encode() if data else None) != 0:
        code = ctypes.get_errno()
        raise OSError(code, f"mount {target}: {os.strerror(code)}")


def _bind(source: str, target: str, readonly: bool, extra: int = 0) -> None:
    _mount(source, target, None, MS_BIND | MS_REC)
    if readonly or extra:
        _mount(None, target, None, MS_REMOUNT | MS_BIND | (MS_RDONLY if readonly else 0) | extra)


def _loopback_up() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        req = struct.pack("16sH14s", b"lo", 0, b"\x00" * 14)
        flags = struct.unpack("16sH14s", fcntl.ioctl(s.fileno(), SIOCGIFFLAGS, req))[1]
        fcntl.ioctl(s.fileno(), SIOCSIFFLAGS, struct.pack("16sH14s", b"lo", flags | IFF_UP, b"\x00" * 14))


def _cgroup_view() -> None:
    """Show the program its own cgroup at /sys/fs/cgroup, read-only, as Docker does (cgroupns=private).

    Runtimes such as the JVM, .NET and Node size their heaps from memory.max there;
    without it they would size them for the whole VM and run into the limit.
    """
    os.unshare(os.CLONE_NEWCGROUP)  # the step's cgroup becomes this namespace's "/"
    _mount("tmpfs", "/sys", "tmpfs", MS_NOSUID | MS_NODEV | MS_NOEXEC, "size=16k,mode=755")
    os.mkdir("/sys/fs", 0o755)
    os.mkdir("/sys/fs/cgroup", 0o755)
    _mount("cgroup2", "/sys/fs/cgroup", "cgroup2", MS_RDONLY | MS_NOSUID | MS_NODEV | MS_NOEXEC)
    _mount(None, "/sys", None, MS_REMOUNT | MS_RDONLY | MS_NOSUID | MS_NODEV | MS_NOEXEC)


def _pivot_root(root: str) -> None:
    """Make `root` the root of this mount namespace and drop the VM's filesystem entirely."""
    os.chdir(root)
    if _libc.syscall(ctypes.c_long(SYS_PIVOT_ROOT), ctypes.c_char_p(b"."), ctypes.c_char_p(b".")) != 0:
        code = ctypes.get_errno()
        raise OSError(code, f"pivot_root: {os.strerror(code)}")
    if _libc.umount2(b".", MNT_DETACH) != 0:
        code = ctypes.get_errno()
        raise OSError(code, f"umount old root: {os.strerror(code)}")
    os.chdir("/")


def _seccomp_filter() -> bytes:
    """A classic BPF program: EPERM for the calls listed above, everything else allowed."""
    ld, jeq, jge, ret = 0x20, 0x15, 0x35, 0x06
    allow, deny, kill = 0x7FFF0000, 0x00050000 | errno.EPERM, 0x80000000
    ins = lambda code, jt, jf, k: struct.pack("HBBI", code, jt, jf, k)  # noqa: E731
    x64 = [ins(ld, 0, 0, 0), ins(jge, 0, 1, X32_SYSCALL_BIT), ins(ret, 0, 0, deny)]
    for nr in _DENY_X86_64:
        x64 += [ins(jeq, 0, 1, nr), ins(ret, 0, 0, deny)]
    x64.append(ins(ret, 0, 0, allow))
    i386 = [ins(jeq, 1, 0, AUDIT_ARCH_I386), ins(ret, 0, 0, kill), ins(ld, 0, 0, 0)]
    for nr in _DENY_I386:
        i386 += [ins(jeq, 0, 1, nr), ins(ret, 0, 0, deny)]
    i386.append(ins(ret, 0, 0, allow))
    head = [ins(ld, 0, 0, 4), ins(jeq, 0, len(x64), AUDIT_ARCH_X86_64)]
    return b"".join(head + x64 + i386)


class _SockFprog(ctypes.Structure):  # struct sock_fprog
    _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.c_void_p)]


def _prepare_seccomp() -> tuple:
    """Build the filter in memory while the VM's Python library is still reachable (before pivot_root)."""
    program = _seccomp_filter()
    buf = ctypes.create_string_buffer(program, len(program))
    return buf, _SockFprog(len(program) // 8, ctypes.addressof(buf))


def _install_seccomp(prepared: tuple) -> None:
    if _libc.prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ctypes.addressof(prepared[1]), 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "could not install the seccomp filter")


def stage(stage_path: Path) -> int:
    """PID 1 of the step's namespaces: build the root, start the program, reap, report."""
    cfg = json.loads(stage_path.read_text())
    root = cfg["root"]
    _bind(cfg["rootfs"], root, readonly=True, extra=MS_NOSUID | MS_NODEV)
    _mount("tmpfs", f"{root}/tmp", "tmpfs", MS_NOSUID | MS_NODEV | MS_NOEXEC, f"size={cfg['tmpMb']}m,mode=1777")
    _bind(cfg["workspace"], f"{root}/workspace", readonly=cfg["workspaceMode"] == "ro", extra=MS_NOSUID | MS_NODEV)

    dev = f"{root}/dev"
    _mount("tmpfs", dev, "tmpfs", MS_NOSUID | MS_NOEXEC, "size=64k,mode=755")
    for name, minor in (("null", 3), ("zero", 5), ("full", 7), ("random", 8), ("urandom", 9)):
        os.mknod(f"{dev}/{name}", 0o666 | 0o020000, os.makedev(1, minor))
        os.chmod(f"{dev}/{name}", 0o666)
    os.mknod(f"{dev}/tty", 0o666 | 0o020000, os.makedev(5, 0))
    os.chmod(f"{dev}/tty", 0o666)
    for link, target in (("fd", "/proc/self/fd"), ("stdin", "/proc/self/fd/0"),
                         ("stdout", "/proc/self/fd/1"), ("stderr", "/proc/self/fd/2")):
        os.symlink(target, f"{dev}/{link}")
    os.mkdir(f"{dev}/shm")
    _mount("tmpfs", f"{dev}/shm", "tmpfs", MS_NOSUID | MS_NODEV | MS_NOEXEC, "size=64m,mode=1777")
    _mount(None, dev, None, MS_REMOUNT | MS_RDONLY | MS_NOSUID | MS_NOEXEC)  # no new device nodes

    proc = f"{root}/proc"
    _mount("proc", proc, "proc", MS_NOSUID | MS_NODEV | MS_NOEXEC)
    for masked in ("kcore", "keys", "timer_list", "sched_debug", "latency_stats"):
        if os.path.exists(f"{proc}/{masked}"):
            _mount(f"{dev}/null", f"{proc}/{masked}", None, MS_BIND)
    for readonly in ("sys", "sysrq-trigger", "irq", "bus", "fs"):
        if os.path.exists(f"{proc}/{readonly}"):
            _bind(f"{proc}/{readonly}", f"{proc}/{readonly}", readonly=True)
    for name in ("hosts", "hostname"):
        if os.path.isfile(f"{root}/etc/{name}") and (ETC / name).is_file():
            _mount(str(ETC / name), f"{root}/etc/{name}", None, MS_BIND)
            _mount(None, f"{root}/etc/{name}", None, MS_REMOUNT | MS_BIND | MS_RDONLY)

    _loopback_up()
    socket.sethostname(HOSTNAME)
    cgroup_procs = os.open(f"{cfg['cgroup']}/cgroup.procs", os.O_WRONLY)  # close-on-exec
    seccomp = _prepare_seccomp()
    _pivot_root(root)  # from here on nothing can be imported: the VM's files are gone

    child = os.fork()
    if child == 0:
        try:
            os.write(cgroup_procs, b"0")  # join the step's cgroup: its memory/pids/cpu limits
            os.close(cgroup_procs)
            if os.path.isdir("/sys"):
                _cgroup_view()
            with open("/proc/self/oom_score_adj", "w") as fh:
                fh.write("1000")  # if the VM itself runs short, the program goes first
            os.chdir(cfg["workdir"])
            resource.setrlimit(resource.RLIMIT_CPU, (cfg["cpuTimeS"], cfg["cpuTimeS"] + 1))
            size = cfg["fileSizeMb"] * MB
            resource.setrlimit(resource.RLIMIT_FSIZE, (size, size))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
            os.setgroups([])
            os.setgid(GID)
            os.setuid(UID)
            if _libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
                raise OSError("could not set no-new-privileges")
            _install_seccomp(seccomp)
            os.umask(0o022)
            for sig in (signal.SIGPIPE, signal.SIGXFSZ):
                signal.signal(sig, signal.SIG_DFL)
            os.execvpe(cfg["argv"][0], cfg["argv"], cfg["env"])
        except BaseException as exc:  # noqa: BLE001 - report and leave like a shell would
            try:
                os.write(2, f"kairo: cannot start {cfg['argv'][0]}: {exc}\n".encode())
            finally:
                os._exit(127)

    os.close(cgroup_procs)
    os.close(0)
    status = None
    while True:
        try:
            pid, st = os.wait()
        except ChildProcessError:
            break
        if pid == child:
            status = st
            try:
                os.kill(-1, signal.SIGKILL)  # PID 1: every other process of this namespace
            except ProcessLookupError:
                pass
    if status is None:
        return 255
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return os.WEXITSTATUS(status)


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[1] == "run":
        return run_job(Path(argv[2]))
    if len(argv) == 3 and argv[1] == "stage":
        return stage(Path(argv[2]))
    if len(argv) == 2 and argv[1] == "health":
        return health()
    sys.stderr.write("usage: kairo_exec.py run JOB.json | health\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
