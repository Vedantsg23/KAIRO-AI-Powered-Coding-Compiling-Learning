/**
 * Saarthi's built-in knowledge, used when no AI model is connected (and as a
 * fallback when the model cannot answer): concept explanations and short,
 * correct how-to programs for the most used languages.
 *
 * Hand-written reference text, not AI output; chat messages built from it are
 * marked `offline` (see assistant/offline.ts).
 */

export interface Concept {
  title: string;
  /** Words that name this concept in a question. */
  aliases: string[];
  text: string;
  /** A tiny example per language family ("c", "cpp", "java", "python", "javascript"...). */
  examples?: Record<string, string>;
}

export const CONCEPTS: Concept[] = [
  {
    title: "Variables",
    aliases: ["variable", "variables", "var", "declare", "declaration", "identifier"],
    text: "A variable is a named box in memory that holds a value. In typed languages (C, C++, Java) you declare its type first, and it can only hold that kind of value; in Python and JavaScript the value decides the type. Give variables clear names (total, count) and a starting value before you read them.",
    examples: { c: "int total = 0;\nfloat price = 9.5f;\nchar grade = 'A';", python: "total = 0\nprice = 9.5\nname = \"Asha\"", java: "int total = 0;\nString name = \"Asha\";", javascript: "let total = 0;\nconst name = \"Asha\";" },
  },
  {
    title: "Data types",
    aliases: ["data type", "data types", "datatype", "int", "float", "double", "char", "boolean", "bool", "type"],
    text: "A data type says what kind of value something is and which operations make sense: whole numbers (int, long), decimals (float, double), single characters (char), true/false (bool/boolean) and text (string). Mixing types can change results: in C and Java 7 / 2 is 3 (whole-number division), but 7.0 / 2 is 3.5.",
  },
  {
    title: "Operators",
    aliases: ["operator", "operators", "modulo", "modulus", "remainder", "%", "increment", "++"],
    text: "Operators combine values: arithmetic (+ - * / %), comparison (== != < > <= >=), logical (&& || ! in C-like languages; and or not in Python) and assignment (= += -=). % gives the remainder: 7 % 3 is 1, and n % 2 == 0 tests for an even number. Remember = assigns while == compares.",
  },
  {
    title: "Conditions (if / else)",
    aliases: ["if", "else", "if else", "condition", "conditions", "conditional", "elif", "else if", "decision"],
    text: "if runs a block only when its condition is true; else runs when it is false; else if (elif in Python) checks further conditions in order, and only the first true branch runs. Conditions are comparisons or combinations of them.",
    examples: {
      c: "if (marks >= 40) {\n    printf(\"Pass\\n\");\n} else {\n    printf(\"Fail\\n\");\n}",
      python: "if marks >= 40:\n    print(\"Pass\")\nelse:\n    print(\"Fail\")",
      java: "if (marks >= 40) {\n    System.out.println(\"Pass\");\n} else {\n    System.out.println(\"Fail\");\n}",
      javascript: "if (marks >= 40) {\n  console.log(\"Pass\");\n} else {\n  console.log(\"Fail\");\n}",
    },
  },
  {
    title: "switch / match",
    aliases: ["switch", "case", "match", "switch case"],
    text: "switch compares one value against several constant cases and jumps to the matching one. In C, C++ and Java each case needs break, otherwise execution falls through into the next case. Python 3.10+ has match/case for the same idea.",
    examples: { c: "switch (choice) {\ncase 1: printf(\"Add\\n\"); break;\ncase 2: printf(\"Delete\\n\"); break;\ndefault: printf(\"Unknown\\n\");\n}" },
  },
  {
    title: "Loops",
    aliases: ["loop", "loops", "for", "for loop", "while", "while loop", "do while", "do-while", "iteration", "iterate", "repeat"],
    text: "A loop repeats a block. Use for when you know how many times (count from 0 to n-1), while when you repeat until something changes, and do-while when the block must run at least once. Every loop needs something inside it that eventually makes the condition false, or it runs forever.",
    examples: {
      c: "for (int i = 0; i < 5; i++) {\n    printf(\"%d\\n\", i);\n}",
      python: "for i in range(5):\n    print(i)",
      java: "for (int i = 0; i < 5; i++) {\n    System.out.println(i);\n}",
      javascript: "for (let i = 0; i < 5; i++) {\n  console.log(i);\n}",
    },
  },
  {
    title: "break and continue",
    aliases: ["break", "continue"],
    text: "break leaves the loop immediately; continue skips the rest of this pass and goes to the next one. In a switch, break ends the case.",
  },
  {
    title: "Functions",
    aliases: ["function", "functions", "method", "methods", "procedure", "subroutine", "def", "return", "call"],
    text: "A function is a named, reusable block of code. It takes inputs (parameters), does its work and can give back a result with return. Calling it runs its body with the values you pass (arguments). Functions keep programs short and each piece testable.",
    examples: {
      c: "int square(int x) {\n    return x * x;\n}\n// square(4) is 16",
      python: "def square(x):\n    return x * x\n\nprint(square(4))  # 16",
      java: "static int square(int x) {\n    return x * x;\n}",
      javascript: "function square(x) {\n  return x * x;\n}",
    },
  },
  {
    title: "Parameters and arguments",
    aliases: ["parameter", "parameters", "argument", "arguments", "pass by value", "pass by reference", "call by value", "call by reference"],
    text: "Parameters are the names in a function's definition; arguments are the values you pass when calling it. In C, Java and Python, arguments are passed by value (the function gets a copy of the value; for objects/lists the copy is a reference, so the function can change the object's contents). In C, pass a pointer (&x) to let a function change the caller's variable.",
  },
  {
    title: "Recursion",
    aliases: ["recursion", "recursive", "recurse", "base case"],
    text: "A recursive function calls itself on a smaller version of the problem. It needs a base case that stops the calls (e.g. n <= 1); without one it recurses forever and the program crashes with a stack overflow. Each call waits for the smaller one to finish, so deep recursion uses a lot of stack memory.",
    examples: {
      c: "int factorial(int n) {\n    if (n <= 1) return 1;      // base case\n    return n * factorial(n - 1);\n}",
      python: "def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)",
    },
  },
  {
    title: "Arrays",
    aliases: ["array", "arrays", "index", "indexing", "subscript", "list index"],
    text: "An array stores many values of the same type in a row. Elements are numbered from 0, so an array of size 5 has indexes 0 to 4; reading index 5 goes past the end (a crash in Java/Python, silent garbage or a crash in C). Loop with i < size, not i <= size.",
    examples: { c: "int a[5] = {3, 1, 4, 1, 5};\nfor (int i = 0; i < 5; i++) printf(\"%d \", a[i]);", python: "a = [3, 1, 4, 1, 5]\nfor x in a:\n    print(x)", java: "int[] a = {3, 1, 4, 1, 5};\nfor (int x : a) System.out.println(x);" },
  },
  {
    title: "Strings",
    aliases: ["string", "strings", "text", "char array", "character array"],
    text: "A string is a sequence of characters. In C it is a char array ending with '\\0' (use strlen, strcpy, strcmp from string.h; never compare with ==). In Java compare strings with .equals(), not ==. In Python strings are immutable: operations return new strings.",
  },
  {
    title: "Pointers",
    aliases: ["pointer", "pointers", "address", "&", "dereference", "*p"],
    text: "A pointer holds a memory address. &x gives the address of x; *p reads (or writes) the value at the address in p. Pointers let functions change the caller's variables, walk through arrays and use heap memory. Using a pointer that is NULL or points to freed memory crashes the program (segmentation fault).",
    examples: { c: "int x = 10;\nint *p = &x;   // p holds x's address\n*p = 20;       // now x is 20\nprintf(\"%d\\n\", x);" },
  },
  {
    title: "Structures",
    aliases: ["struct", "structure", "structures", "record", "typedef"],
    text: "A struct groups related values of different types under one name, such as a student's name, roll number and marks. Access fields with . (or -> through a pointer).",
    examples: { c: "struct Student {\n    char name[20];\n    int marks;\n};\nstruct Student s = {\"Asha\", 91};\nprintf(\"%s %d\\n\", s.name, s.marks);" },
  },
  {
    title: "Classes and objects",
    aliases: ["class", "classes", "object", "objects", "oop", "object oriented", "instance", "constructor", "this", "self"],
    text: "A class is a blueprint: it defines data (fields) and behaviour (methods). An object is one instance made from it. The constructor sets up a new object's fields (__init__ in Python). Object-oriented programming builds programs from such objects.",
    examples: {
      java: "class Student {\n    String name;\n    int marks;\n    Student(String name, int marks) {\n        this.name = name;\n        this.marks = marks;\n    }\n}",
      python: "class Student:\n    def __init__(self, name, marks):\n        self.name = name\n        self.marks = marks",
      cpp: "class Student {\npublic:\n    string name;\n    int marks;\n    Student(string n, int m) : name(n), marks(m) {}\n};",
    },
  },
  {
    title: "Inheritance",
    aliases: ["inheritance", "inherit", "extends", "subclass", "parent class", "child class", "super"],
    text: "Inheritance lets a class reuse and extend another: the child class gets the parent's fields and methods and can add or override them. Use it for an 'is a' relationship (a Car is a Vehicle).",
  },
  {
    title: "Polymorphism",
    aliases: ["polymorphism", "overriding", "overloading", "virtual", "method overriding", "method overloading"],
    text: "Polymorphism means one interface, many forms. Overloading: several methods with the same name but different parameters. Overriding: a subclass gives its own version of a parent's method, and the object's real class decides which runs.",
  },
  {
    title: "Encapsulation and abstraction",
    aliases: ["encapsulation", "abstraction", "private", "public", "protected", "getter", "setter", "access modifier"],
    text: "Encapsulation hides an object's data behind methods (private fields with public getters/setters) so it can only change in valid ways. Abstraction shows only what a user of a class needs and hides the details (abstract classes, interfaces).",
  },
  {
    title: "Exceptions",
    aliases: ["exception", "exceptions", "try", "catch", "except", "throw", "raise", "error handling", "finally"],
    text: "An exception signals an error while the program runs. try wraps code that might fail; catch (except in Python) handles a specific error; finally runs either way. Handle only errors you can do something about, and show a helpful message.",
    examples: { python: "try:\n    n = int(input())\nexcept ValueError:\n    print(\"Please type a number\")", java: "try {\n    int n = Integer.parseInt(text);\n} catch (NumberFormatException e) {\n    System.out.println(\"Not a number\");\n}" },
  },
  {
    title: "Lists, maps and sets",
    aliases: ["list", "lists", "dictionary", "dict", "map", "hashmap", "hash map", "set", "arraylist", "vector", "collection"],
    text: "A list (ArrayList, vector) is a growable sequence; a map/dictionary stores key → value pairs for fast lookup by key; a set stores unique values. Pick a map when you look things up by name or id, a list when order matters.",
    examples: { python: "marks = {\"Asha\": 91, \"Ravi\": 78}\nprint(marks[\"Asha\"])", java: "Map<String, Integer> marks = new HashMap<>();\nmarks.put(\"Asha\", 91);" },
  },
  {
    title: "Stacks and queues",
    aliases: ["stack", "stacks", "queue", "queues", "lifo", "fifo", "push", "pop", "enqueue", "dequeue"],
    text: "A stack is last-in, first-out (push and pop at the top), like a pile of plates; function calls use a stack. A queue is first-in, first-out (add at the back, remove at the front), like a line at a counter.",
  },
  {
    title: "Linked lists",
    aliases: ["linked list", "linked lists", "node", "nodes", "singly linked", "doubly linked"],
    text: "A linked list is a chain of nodes; each node holds a value and a pointer to the next node. Inserting at the front is fast, but finding the i-th element means walking the chain. The last node's next is NULL.",
    examples: { c: "struct Node {\n    int data;\n    struct Node *next;\n};" },
  },
  {
    title: "Trees",
    aliases: ["tree", "trees", "binary tree", "bst", "binary search tree", "traversal", "inorder", "preorder", "postorder"],
    text: "A tree stores items in a hierarchy: each node has children. In a binary search tree every left child is smaller and every right child larger, so searching halves the work at each step (O(log n) when balanced). Traversals visit nodes in a fixed order: inorder (left, node, right) gives a BST's values sorted.",
  },
  {
    title: "Sorting",
    aliases: ["sort", "sorting", "bubble sort", "selection sort", "insertion sort", "merge sort", "quick sort", "quicksort"],
    text: "Sorting puts items in order. Simple sorts (bubble, selection, insertion) take about n² steps; merge sort and quicksort take about n log n. In real programs use the library: qsort (C), std::sort (C++), Arrays.sort / Collections.sort (Java), sorted() / list.sort() (Python).",
    examples: { c: "// bubble sort\nfor (int i = 0; i < n - 1; i++)\n    for (int j = 0; j < n - 1 - i; j++)\n        if (a[j] > a[j + 1]) { int t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; }" },
  },
  {
    title: "Searching",
    aliases: ["search", "searching", "linear search", "binary search"],
    text: "Linear search checks items one by one (up to n steps). Binary search works on sorted data: compare with the middle and discard half each time (about log₂ n steps: 20 steps for a million items).",
  },
  {
    title: "Time complexity (Big-O)",
    aliases: ["complexity", "time complexity", "big o", "big-o", "o(n)", "efficiency", "space complexity", "asymptotic"],
    text: "Big-O describes how the work grows with the input size n. O(1): constant; O(log n): halving (binary search); O(n): one loop; O(n log n): good sorting; O(n²): two nested loops; O(2ⁿ): naive recursion that calls itself twice (like fib(n-1) + fib(n-2)). KAIRO's Complexity Lens shows an estimate above each function.",
  },
  {
    title: "Memory: stack and heap",
    aliases: ["memory", "stack memory", "heap", "heap memory", "malloc", "calloc", "free", "new", "delete", "dynamic memory", "memory leak"],
    text: "Local variables live on the stack and disappear when their function returns. Heap memory (malloc/free in C, new/delete in C++, new in Java) lives until you free it (or the garbage collector does). Forgetting free leaks memory; using memory after free or through a bad pointer crashes.",
    examples: { c: "int *a = malloc(n * sizeof *a);\nif (a == NULL) return 1;\n/* use a[0] .. a[n-1] */\nfree(a);" },
  },
  {
    title: "Segmentation fault",
    aliases: ["segmentation fault", "segfault", "sigsegv", "core dumped", "access violation"],
    text: "A segmentation fault means the program touched memory it may not use: dereferencing NULL or an uninitialised pointer, reading past an array's end, or recursing too deep. Check pointers before use, keep indexes in range and make sure recursion stops.",
  },
  {
    title: "Null pointer / null reference",
    aliases: ["null", "null pointer", "nullpointerexception", "none", "nil", "undefined", "npe"],
    text: "null (NULL, None, nil) means 'no object'. Using it as if it were one — calling a method, reading a field, dereferencing — crashes (NullPointerException, segmentation fault, AttributeError on None). Check for null or make sure the variable was assigned.",
  },
  {
    title: "Stack overflow",
    aliases: ["stack overflow", "stackoverflowerror", "recursionerror", "maximum recursion depth"],
    text: "A stack overflow happens when function calls nest too deeply, usually recursion without a reachable base case. Each call needs stack space; when it runs out the program stops.",
  },
  {
    title: "Infinite loops",
    aliases: ["infinite loop", "infinite", "never ends", "hang", "time limit", "timeout", "stuck"],
    text: "A loop runs forever when its condition never becomes false: the loop variable never changes, it changes the wrong way, or a stray ';' makes the loop body empty. KAIRO stops programs after a time limit and Saarthi's tips warn about loops whose variable never changes.",
  },
  {
    title: "Integer overflow",
    aliases: ["overflow", "integer overflow", "int max", "large numbers", "long long"],
    text: "A fixed-size integer has a range (int is about ±2.1 billion). Going past it wraps around to wrong values (or is undefined in C). Use long / long long for big values, or Python's unlimited integers.",
  },
  {
    title: "Syntax, compile-time and runtime errors",
    aliases: ["syntax error", "compile error", "compile time error", "runtime error", "logical error", "logic error", "types of errors", "error types"],
    text: "Syntax errors break the language's grammar (a missing ';' or ':'): KAIRO's live analyzer shows them while you type. Compile-time errors are found by the compiler (unknown names, wrong types). Runtime errors happen while the program runs (division by zero, crashes). Logical errors give wrong answers without any message: test with known inputs.",
  },
  {
    title: "Compilers and interpreters",
    aliases: ["compiler", "compilers", "interpreter", "interpreters", "compilation", "compile", "bytecode", "jvm"],
    text: "A compiler translates the whole program to machine code (or bytecode) before it runs (C, C++, Go, Rust; Java to JVM bytecode). An interpreter runs the program statement by statement (Python, Ruby, Bash; modern ones compile to bytecode first). KAIRO shows each step (compile, link, run) in the run pipeline.",
  },
  {
    title: "Phases of a compiler",
    aliases: ["phases of compiler", "compiler phases", "phases of a compiler", "lexical analysis", "lexer", "tokens", "token", "parser", "parsing", "syntax analysis", "semantic analysis", "ast", "abstract syntax tree", "intermediate code", "code generation", "code optimization", "symbol table"],
    text: "A compiler works in phases: 1) lexical analysis splits the text into tokens (keywords, names, numbers, symbols); 2) syntax analysis (parsing) checks the grammar and builds a syntax tree; 3) semantic analysis checks meaning (declared names, types) using a symbol table; 4) intermediate code generation; 5) optimization; 6) code generation to machine code. KAIRO's live analyzer does 1-2 in your browser with Tree-sitter, the real compiler does all of them when you press Run.",
  },
  {
    title: "Preprocessor, linker and loader",
    aliases: ["preprocessor", "#include", "#define", "macro", "macros", "linker", "linking", "loader", "undefined reference", "header file", "header"],
    text: "In C/C++ the preprocessor first handles # lines: #include pastes header files in, #define replaces macros. The compiler turns each file into object code, then the linker joins it with libraries into an executable ('undefined reference' is a linker error: a function was declared but never defined, or a library is missing). The loader puts the program in memory to run.",
  },
  {
    title: "Scope",
    aliases: ["scope", "local variable", "global variable", "global", "local", "lifetime", "static"],
    text: "Scope is where a name is visible. A local variable exists only inside its block or function; a global is visible everywhere (use sparingly). A static local variable in C keeps its value between calls.",
  },
  {
    title: "Constants",
    aliases: ["const", "constant", "constants", "final", "#define constant"],
    text: "A constant is a value that must not change: const in C/C++/JavaScript, final in Java, UPPER_CASE names by convention in Python. The compiler refuses code that tries to change it.",
  },
  {
    title: "Input and output",
    aliases: ["input", "output", "stdin", "stdout", "read input", "scanf", "printf", "cin", "cout", "scanner", "print", "i/o", "io"],
    text: "Programs read from standard input and write to standard output. In KAIRO, type the program's input in the Input tab (or stdin.txt in the explorer) before you press Run: it is sent to the program exactly as typed. Output appears in the terminal.",
  },
  {
    title: "Files",
    aliases: ["file", "files", "file handling", "fopen", "open file", "read file", "write file", "file i/o"],
    text: "To use a file: open it (with a mode: read, write, append), read or write, then close it. In KAIRO's sandbox the program can create files in its own temporary folder (/tmp), and everything is thrown away after the run.",
  },
  {
    title: "Type casting",
    aliases: ["type casting", "typecast", "casting", "cast", "type conversion", "convert", "conversion"],
    text: "Casting converts a value to another type: (double) sum / n in C gives a decimal average; int(\"42\") in Python and Integer.parseInt(\"42\") in Java turn text into numbers. Converting a decimal to int drops the fraction.",
  },
  {
    title: "Boolean logic",
    aliases: ["and", "or", "not", "logical operators", "&&", "||", "boolean logic", "truth table"],
    text: "Logical operators combine conditions: AND (&&, and) is true only if both sides are; OR (||, or) if at least one is; NOT (!, not) flips it. They short-circuit: in a && b, b is not evaluated when a is false.",
  },
];

/** Words that commonly name a how-to task, mapped to a task id. */
export const HOWTO_TASKS: [RegExp, string, string][] = [
  [/read(ing)?\s+(an?\s+)?(integer|int|number|numbers|input|value)|take\s+input|user input|get input/, "read-number", "Read a number from input"],
  [/read(ing)?\s+(a\s+)?(line|string|word|name|text)/, "read-line", "Read a line of text"],
  [/print|output|display|show/, "print", "Print output"],
  [/sum|add\s+numbers|total/, "sum", "Sum of numbers"],
  [/factorial/, "factorial", "Factorial"],
  [/fibonacci|fibo/, "fibonacci", "Fibonacci numbers"],
  [/prime/, "prime", "Check a prime number"],
  [/reverse.*string|string.*reverse/, "reverse-string", "Reverse a string"],
  [/palindrome/, "palindrome", "Palindrome check"],
  [/largest|maximum|max|biggest/, "max", "Largest element"],
  [/sort/, "sort", "Sort numbers"],
  [/swap/, "swap", "Swap two values"],
  [/even|odd/, "even-odd", "Even or odd"],
  [/array|list/, "array", "Read and use an array"],
  [/function|method/, "function", "Write a function"],
  [/class|object/, "class", "Class and object"],
  [/file/, "file", "Write and read a file"],
  [/loop|for|while/, "loop", "Loops"],
];

/** Short, correct programs per task and language. */
export const HOWTO: Record<string, Record<string, string>> = {
  "read-number": {
    c: '#include <stdio.h>\n\nint main(void) {\n    int n;\n    if (scanf("%d", &n) != 1) return 1;\n    printf("You typed %d\\n", n);\n    return 0;\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    cout << "You typed " << n << endl;\n}',
    java: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        System.out.println("You typed " + n);\n    }\n}',
    python: 'n = int(input())\nprint("You typed", n)',
    javascript: 'const n = Number(require("fs").readFileSync(0, "utf8").trim());\nconsole.log("You typed", n);',
  },
  "read-line": {
    c: '#include <stdio.h>\n#include <string.h>\n\nint main(void) {\n    char line[100];\n    if (fgets(line, sizeof line, stdin)) {\n        line[strcspn(line, "\\n")] = \'\\0\';\n        printf("Hello, %s!\\n", line);\n    }\n    return 0;\n}',
    cpp: '#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string name;\n    getline(cin, name);\n    cout << "Hello, " << name << "!" << endl;\n}',
    java: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        String name = sc.nextLine();\n        System.out.println("Hello, " + name + "!");\n    }\n}',
    python: 'name = input()\nprint(f"Hello, {name}!")',
    javascript: 'const name = require("fs").readFileSync(0, "utf8").trim();\nconsole.log(`Hello, ${name}!`);',
  },
  print: {
    c: '#include <stdio.h>\n\nint main(void) {\n    int age = 20;\n    printf("Age: %d\\n", age);   /* %d int, %f double, %c char, %s string */\n    return 0;\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    int age = 20;\n    cout << "Age: " << age << endl;\n}',
    java: 'public class Main {\n    public static void main(String[] args) {\n        int age = 20;\n        System.out.println("Age: " + age);\n        System.out.printf("Age: %d%n", age);\n    }\n}',
    python: 'age = 20\nprint("Age:", age)\nprint(f"Age: {age}")',
    javascript: 'const age = 20;\nconsole.log("Age:", age);\nconsole.log(`Age: ${age}`);',
  },
  sum: {
    c: '#include <stdio.h>\n\nint main(void) {\n    int n, x, sum = 0;\n    scanf("%d", &n);\n    for (int i = 0; i < n; i++) {\n        scanf("%d", &x);\n        sum += x;\n    }\n    printf("Sum = %d\\n", sum);\n    return 0;\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    int n, x, sum = 0;\n    cin >> n;\n    for (int i = 0; i < n; i++) { cin >> x; sum += x; }\n    cout << "Sum = " << sum << endl;\n}',
    java: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt(), sum = 0;\n        for (int i = 0; i < n; i++) sum += sc.nextInt();\n        System.out.println("Sum = " + sum);\n    }\n}',
    python: 'n = int(input())\nnums = list(map(int, input().split()))\nprint("Sum =", sum(nums[:n]))',
    javascript: 'const [n, ...nums] = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);\nconsole.log("Sum =", nums.slice(0, n).reduce((a, b) => a + b, 0));',
  },
  factorial: {
    c: '#include <stdio.h>\n\nlong long factorial(int n) {\n    return n <= 1 ? 1 : n * factorial(n - 1);\n}\n\nint main(void) {\n    int n;\n    scanf("%d", &n);\n    printf("%d! = %lld\\n", n, factorial(n));\n    return 0;\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nlong long factorial(int n) { return n <= 1 ? 1 : n * factorial(n - 1); }\n\nint main() {\n    int n;\n    cin >> n;\n    cout << n << "! = " << factorial(n) << endl;\n}',
    java: 'public class Main {\n    static long factorial(int n) {\n        return n <= 1 ? 1 : n * factorial(n - 1);\n    }\n    public static void main(String[] args) {\n        System.out.println(factorial(5));\n    }\n}',
    python: 'def factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\n\nprint(factorial(int(input())))',
    javascript: 'function factorial(n) {\n  return n <= 1 ? 1 : n * factorial(n - 1);\n}\nconsole.log(factorial(5));',
  },
  fibonacci: {
    c: '#include <stdio.h>\n\nint main(void) {\n    int n;\n    long long a = 0, b = 1;\n    scanf("%d", &n);\n    for (int i = 0; i < n; i++) {\n        printf("%lld ", a);\n        long long next = a + b;\n        a = b;\n        b = next;\n    }\n    printf("\\n");\n    return 0;\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    long long a = 0, b = 1;\n    for (int i = 0; i < n; i++) { cout << a << " "; long long t = a + b; a = b; b = t; }\n    cout << endl;\n}',
    java: 'public class Main {\n    public static void main(String[] args) {\n        long a = 0, b = 1;\n        for (int i = 0; i < 10; i++) {\n            System.out.print(a + " ");\n            long t = a + b; a = b; b = t;\n        }\n        System.out.println();\n    }\n}',
    python: 'n = int(input())\na, b = 0, 1\nfor _ in range(n):\n    print(a, end=" ")\n    a, b = b, a + b\nprint()',
    javascript: 'let a = 0, b = 1;\nconst out = [];\nfor (let i = 0; i < 10; i++) { out.push(a); [a, b] = [b, a + b]; }\nconsole.log(out.join(" "));',
  },
  prime: {
    c: '#include <stdio.h>\n#include <stdbool.h>\n\nbool is_prime(int n) {\n    if (n < 2) return false;\n    for (int i = 2; i * i <= n; i++)\n        if (n % i == 0) return false;\n    return true;\n}\n\nint main(void) {\n    int n;\n    scanf("%d", &n);\n    printf("%d is %sprime\\n", n, is_prime(n) ? "" : "not ");\n    return 0;\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nbool isPrime(int n) {\n    if (n < 2) return false;\n    for (int i = 2; i * i <= n; i++) if (n % i == 0) return false;\n    return true;\n}\n\nint main() {\n    int n; cin >> n;\n    cout << n << (isPrime(n) ? " is prime" : " is not prime") << endl;\n}',
    java: 'public class Main {\n    static boolean isPrime(int n) {\n        if (n < 2) return false;\n        for (int i = 2; (long) i * i <= n; i++) if (n % i == 0) return false;\n        return true;\n    }\n    public static void main(String[] args) {\n        System.out.println(isPrime(29));\n    }\n}',
    python: 'def is_prime(n):\n    if n < 2:\n        return False\n    i = 2\n    while i * i <= n:\n        if n % i == 0:\n            return False\n        i += 1\n    return True\n\nprint(is_prime(int(input())))',
    javascript: 'function isPrime(n) {\n  if (n < 2) return false;\n  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;\n  return true;\n}\nconsole.log(isPrime(29));',
  },
  "reverse-string": {
    c: '#include <stdio.h>\n#include <string.h>\n\nint main(void) {\n    char s[100];\n    scanf("%99s", s);\n    int n = strlen(s);\n    for (int i = 0; i < n / 2; i++) {\n        char t = s[i];\n        s[i] = s[n - 1 - i];\n        s[n - 1 - i] = t;\n    }\n    printf("%s\\n", s);\n    return 0;\n}',
    cpp: '#include <algorithm>\n#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string s;\n    cin >> s;\n    reverse(s.begin(), s.end());\n    cout << s << endl;\n}',
    java: 'public class Main {\n    public static void main(String[] args) {\n        String s = "hello";\n        System.out.println(new StringBuilder(s).reverse());\n    }\n}',
    python: 's = input()\nprint(s[::-1])',
    javascript: 'const s = "hello";\nconsole.log(s.split("").reverse().join(""));',
  },
  palindrome: {
    c: '#include <stdio.h>\n#include <string.h>\n\nint main(void) {\n    char s[100];\n    scanf("%99s", s);\n    int n = strlen(s), ok = 1;\n    for (int i = 0; i < n / 2; i++)\n        if (s[i] != s[n - 1 - i]) ok = 0;\n    printf(ok ? "Palindrome\\n" : "Not a palindrome\\n");\n    return 0;\n}',
    python: 's = input().lower()\nprint("Palindrome" if s == s[::-1] else "Not a palindrome")',
    java: 'public class Main {\n    public static void main(String[] args) {\n        String s = "level";\n        boolean ok = new StringBuilder(s).reverse().toString().equals(s);\n        System.out.println(ok ? "Palindrome" : "Not a palindrome");\n    }\n}',
    cpp: '#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string s; cin >> s;\n    string r(s.rbegin(), s.rend());\n    cout << (s == r ? "Palindrome" : "Not a palindrome") << endl;\n}',
    javascript: 'const s = "level";\nconsole.log(s === [...s].reverse().join("") ? "Palindrome" : "Not a palindrome");',
  },
  max: {
    c: '#include <stdio.h>\n\nint main(void) {\n    int a[] = {4, 9, 2, 7};\n    int n = sizeof a / sizeof a[0];\n    int max = a[0];\n    for (int i = 1; i < n; i++)\n        if (a[i] > max) max = a[i];\n    printf("Largest = %d\\n", max);\n    return 0;\n}',
    python: 'nums = [4, 9, 2, 7]\nprint("Largest =", max(nums))',
    java: 'import java.util.Arrays;\n\npublic class Main {\n    public static void main(String[] args) {\n        int[] a = {4, 9, 2, 7};\n        System.out.println("Largest = " + Arrays.stream(a).max().getAsInt());\n    }\n}',
    cpp: '#include <algorithm>\n#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    vector<int> a = {4, 9, 2, 7};\n    cout << "Largest = " << *max_element(a.begin(), a.end()) << endl;\n}',
    javascript: 'const nums = [4, 9, 2, 7];\nconsole.log("Largest =", Math.max(...nums));',
  },
  sort: {
    c: '#include <stdio.h>\n#include <stdlib.h>\n\nint compare(const void *a, const void *b) {\n    return (*(const int *)a > *(const int *)b) - (*(const int *)a < *(const int *)b);\n}\n\nint main(void) {\n    int a[] = {5, 2, 9, 1};\n    int n = sizeof a / sizeof a[0];\n    qsort(a, n, sizeof a[0], compare);\n    for (int i = 0; i < n; i++) printf("%d ", a[i]);\n    printf("\\n");\n    return 0;\n}',
    cpp: '#include <algorithm>\n#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    vector<int> a = {5, 2, 9, 1};\n    sort(a.begin(), a.end());\n    for (int x : a) cout << x << " ";\n    cout << endl;\n}',
    java: 'import java.util.Arrays;\n\npublic class Main {\n    public static void main(String[] args) {\n        int[] a = {5, 2, 9, 1};\n        Arrays.sort(a);\n        System.out.println(Arrays.toString(a));\n    }\n}',
    python: 'nums = [5, 2, 9, 1]\nnums.sort()\nprint(nums)',
    javascript: 'const nums = [5, 2, 9, 1];\nnums.sort((a, b) => a - b);  // numbers need a compare function\nconsole.log(nums);',
  },
  swap: {
    c: '#include <stdio.h>\n\nvoid swap(int *a, int *b) {\n    int t = *a;\n    *a = *b;\n    *b = t;\n}\n\nint main(void) {\n    int x = 1, y = 2;\n    swap(&x, &y);\n    printf("%d %d\\n", x, y);\n    return 0;\n}',
    python: 'x, y = 1, 2\nx, y = y, x\nprint(x, y)',
    java: 'public class Main {\n    public static void main(String[] args) {\n        int x = 1, y = 2;\n        int t = x; x = y; y = t;\n        System.out.println(x + " " + y);\n    }\n}',
    cpp: '#include <iostream>\n#include <utility>\nusing namespace std;\n\nint main() {\n    int x = 1, y = 2;\n    swap(x, y);\n    cout << x << " " << y << endl;\n}',
    javascript: 'let x = 1, y = 2;\n[x, y] = [y, x];\nconsole.log(x, y);',
  },
  "even-odd": {
    c: '#include <stdio.h>\n\nint main(void) {\n    int n;\n    scanf("%d", &n);\n    printf("%d is %s\\n", n, n % 2 == 0 ? "even" : "odd");\n    return 0;\n}',
    python: 'n = int(input())\nprint(n, "is", "even" if n % 2 == 0 else "odd")',
    java: 'public class Main {\n    public static void main(String[] args) {\n        int n = 7;\n        System.out.println(n + (n % 2 == 0 ? " is even" : " is odd"));\n    }\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    int n; cin >> n;\n    cout << n << (n % 2 == 0 ? " is even" : " is odd") << endl;\n}',
    javascript: 'const n = 7;\nconsole.log(`${n} is ${n % 2 === 0 ? "even" : "odd"}`);',
  },
  array: {
    c: '#include <stdio.h>\n\nint main(void) {\n    int n;\n    scanf("%d", &n);\n    int a[n];\n    for (int i = 0; i < n; i++) scanf("%d", &a[i]);\n    for (int i = 0; i < n; i++) printf("%d ", a[i] * 2);\n    printf("\\n");\n    return 0;\n}',
    cpp: '#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    int n; cin >> n;\n    vector<int> a(n);\n    for (auto& x : a) cin >> x;\n    for (int x : a) cout << x * 2 << " ";\n    cout << endl;\n}',
    java: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int[] a = new int[n];\n        for (int i = 0; i < n; i++) a[i] = sc.nextInt();\n        for (int x : a) System.out.print(x * 2 + " ");\n        System.out.println();\n    }\n}',
    python: 'n = int(input())\na = list(map(int, input().split()))[:n]\nprint(*[x * 2 for x in a])',
    javascript: 'const a = [1, 2, 3];\nconsole.log(a.map((x) => x * 2).join(" "));',
  },
  function: {
    c: '#include <stdio.h>\n\nint add(int a, int b) {\n    return a + b;\n}\n\nint main(void) {\n    printf("%d\\n", add(2, 3));\n    return 0;\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nint add(int a, int b) { return a + b; }\n\nint main() {\n    cout << add(2, 3) << endl;\n}',
    java: 'public class Main {\n    static int add(int a, int b) {\n        return a + b;\n    }\n    public static void main(String[] args) {\n        System.out.println(add(2, 3));\n    }\n}',
    python: 'def add(a, b):\n    return a + b\n\nprint(add(2, 3))',
    javascript: 'const add = (a, b) => a + b;\nconsole.log(add(2, 3));',
  },
  class: {
    java: 'class Student {\n    private final String name;\n    private final int marks;\n\n    Student(String name, int marks) {\n        this.name = name;\n        this.marks = marks;\n    }\n\n    boolean passed() {\n        return marks >= 40;\n    }\n}\n\npublic class Main {\n    public static void main(String[] args) {\n        Student s = new Student("Asha", 91);\n        System.out.println(s.passed());\n    }\n}',
    python: 'class Student:\n    def __init__(self, name, marks):\n        self.name = name\n        self.marks = marks\n\n    def passed(self):\n        return self.marks >= 40\n\n\ns = Student("Asha", 91)\nprint(s.passed())',
    cpp: '#include <iostream>\n#include <string>\nusing namespace std;\n\nclass Student {\npublic:\n    Student(string name, int marks) : name(name), marks(marks) {}\n    bool passed() const { return marks >= 40; }\nprivate:\n    string name;\n    int marks;\n};\n\nint main() {\n    Student s("Asha", 91);\n    cout << boolalpha << s.passed() << endl;\n}',
    javascript: 'class Student {\n  constructor(name, marks) {\n    this.name = name;\n    this.marks = marks;\n  }\n  passed() {\n    return this.marks >= 40;\n  }\n}\nconsole.log(new Student("Asha", 91).passed());',
    c: '#include <stdio.h>\n\n/* C has no classes: use a struct and functions. */\nstruct Student {\n    char name[20];\n    int marks;\n};\n\nint passed(const struct Student *s) {\n    return s->marks >= 40;\n}\n\nint main(void) {\n    struct Student s = {"Asha", 91};\n    printf("%d\\n", passed(&s));\n    return 0;\n}',
  },
  file: {
    c: '#include <stdio.h>\n\nint main(void) {\n    FILE *f = fopen("/tmp/data.txt", "w");\n    if (!f) return 1;\n    fprintf(f, "42\\n");\n    fclose(f);\n\n    int x;\n    f = fopen("/tmp/data.txt", "r");\n    fscanf(f, "%d", &x);\n    fclose(f);\n    printf("Read %d\\n", x);\n    return 0;\n}',
    python: 'with open("/tmp/data.txt", "w") as f:\n    f.write("42\\n")\n\nwith open("/tmp/data.txt") as f:\n    print("Read", f.read().strip())',
    java: 'import java.nio.file.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        Path p = Path.of("/tmp/data.txt");\n        Files.writeString(p, "42\\n");\n        System.out.println("Read " + Files.readString(p).trim());\n    }\n}',
    cpp: '#include <fstream>\n#include <iostream>\nusing namespace std;\n\nint main() {\n    ofstream("/tmp/data.txt") << 42 << endl;\n    int x;\n    ifstream("/tmp/data.txt") >> x;\n    cout << "Read " << x << endl;\n}',
    javascript: 'const fs = require("fs");\nfs.writeFileSync("/tmp/data.txt", "42\\n");\nconsole.log("Read", fs.readFileSync("/tmp/data.txt", "utf8").trim());',
  },
  loop: {
    c: '#include <stdio.h>\n\nint main(void) {\n    for (int i = 1; i <= 5; i++) printf("%d ", i);\n    printf("\\n");\n    int n = 5;\n    while (n > 0) {\n        printf("%d ", n);\n        n--;\n    }\n    printf("\\n");\n    return 0;\n}',
    python: 'for i in range(1, 6):\n    print(i, end=" ")\nprint()\nn = 5\nwhile n > 0:\n    print(n, end=" ")\n    n -= 1\nprint()',
    java: 'public class Main {\n    public static void main(String[] args) {\n        for (int i = 1; i <= 5; i++) System.out.print(i + " ");\n        System.out.println();\n        int n = 5;\n        while (n > 0) { System.out.print(n + " "); n--; }\n        System.out.println();\n    }\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    for (int i = 1; i <= 5; i++) cout << i << " ";\n    cout << endl;\n}',
    javascript: 'for (let i = 1; i <= 5; i++) console.log(i);',
  },
};

/** Language family used to pick examples ("react" shows JavaScript, "kotlin" falls back to Java...). */
export function familyOf(languageId: string): string {
  if (languageId === "react" || languageId === "typescript") return "javascript";
  if (languageId === "kotlin" || languageId === "csharp") return "java";
  return languageId;
}
