// Test file to verify pending-lines tracking
function testFn() {
  return "hello from test";
}

// New function added by AI
function square(n) {
  return n * n;
}

function cube(n) {
  return n * n * n;
}

function factorial(n) {
  if (n <= 1) { return 1; }
  return n * factorial(n - 1);
}

function fibonacci(n) {
  if (n <= 0) { return 0; }
  if (n === 1) { return 1; }
  return fibonacci(n - 1) + fibonacci(n - 2);
}

function isPalindrome(str) {
  const reversed = str.split("").reverse().join("");
  return str === reversed;
}

console.log("square(4):", square(4));
console.log("cube(3):", cube(3));
console.log("factorial(5):", factorial(5));
console.log("fibonacci(7):", fibonacci(7));
console.log("isPalindrome('racecar'):", isPalindrome("racecar"));
