For every developer and AI model, it's essential to follow coding guidelines to ensure the codebase is clean, readable, and maintainable. Here are some coding guidelines that can be followed:

# Coding Guidelines**

## **Introduction**
The goal of these guidelines is to ensure that the code written by or for Claude Dev adheres to high standards of clarity, simplicity, maintainability, and performance. By following these guidelines, developers can produce clean code, reduce complexity, and ensure that the software architecture aligns with industry best practices.

## **1. General Best Practices**

### **1.1. Write Clean and Readable Code**
- **Simplicity over cleverness**: Code should be as simple as possible while achieving the desired functionality. Avoid over-engineering and complex solutions.
- **Naming Conventions**: Use meaningful, descriptive names for variables, functions, classes, and files. Follow consistent naming conventions (e.g., camelCase for variables, PascalCase for classes).
  - Example: `getCustomerData()` instead of `gcd()`.
- **Comments**: Use comments to explain the "why" behind complex logic, not the "what." Code should be self-explanatory. Use comments sparingly but wisely.
  - Example: `// Fetching customer data from the API with retry logic`
- **Code formatting**: Adhere to consistent indentation, spacing, and alignment. Use a linter (e.g., ESLint for JavaScript) to enforce formatting rules.

### **1.2. Avoid Code Duplication**
- **DRY (Don't Repeat Yourself)**: Extract common functionality into reusable functions or modules. Avoid duplicating logic across multiple places in the codebase.
  - Example: Instead of copying and pasting validation logic across different classes, create a reusable `ValidationHelper` class.

### **1.3. Follow SOLID Principles**
Ensure that your code adheres to the five SOLID principles of object-oriented design to improve maintainability and extensibility:
- **Single Responsibility Principle**: A class or function should have only one reason to change. Keep responsibilities narrow.
- **Open/Closed Principle**: Classes should be open for extension but closed for modification.
- **Liskov Substitution Principle**: Subtypes should be substitutable for their base types without breaking the system.
- **Interface Segregation Principle**: Clients should not be forced to depend on interfaces they do not use.
- **Dependency Inversion Principle**: Depend on abstractions rather than concrete implementations.

---

## **2. Methodology for Writing Code**

### **2.1. Keep Functions Short and Focused**
- **Function Length**: Aim for functions to be concise and focused on doing one thing well. Ideally, a function should fit within 10-20 lines.
- **Single Responsibility**: Each function should perform one task. If a function is doing more than one task, break it into smaller functions.
- **Example**:
  ```typescript
function fetchUserData(userId: number): User {
  const database: Database = /* initialize your database connection */;
  const user: User = database.getUserById(userId);
  return user;
}
  ```

### **2.2. Avoid Large Classes**
- **Cohesion**: Keep classes small and cohesive. Each class should have a focused responsibility and should be easy to understand in isolation.
- **Decompose Complexity**: If a class becomes too large, decompose it into smaller, more specialized classes.
- **Use Inheritance Wisely**: Avoid deep inheritance hierarchies. Prefer composition over inheritance where applicable.

---

## **3. Code Complexity and Maintainability**

### **3.1. Reduce Cyclomatic Complexity**
- Keep the number of conditional branches (if-else, switches) to a minimum. Use polymorphism or strategy patterns to reduce branching where applicable.
- **Refactor deeply nested code**: When you encounter deeply nested structures, refactor into smaller methods or use early returns to simplify control flow.

### **3.2. Avoid Premature Optimization**
- **Focus on readability first**: Don't optimize too early in the development process. Write clear and simple code first, and optimize performance only when necessary.

### **3.3. Break Long Expressions**
- Avoid long, complex expressions in a single line. Break them down into intermediate steps or use helper functions to improve readability.
  - Example:
    ```python
    result = computeTax(calculateDiscountPrice(product.price, discount))
    # Instead of:
    # result = computeTax(product.price - (product.price * discount))
    ```

---

## **4. Testing and Validation**

### **4.1. Test-Driven Development (TDD)**
- Wherever possible, follow TDD principles: write the test first, then write the minimal code needed to pass the test. Refactor as needed after passing the tests.
  
### **4.2. Unit Testing**
- Write unit tests for every function or method that contains business logic. Use mocks and stubs to isolate the component being tested.
  
### **4.3. Code Coverage**
- Aim for high code coverage, but don't sacrifice test quality for the sake of coverage numbers. Tests should verify correct behavior, handle edge cases, and validate performance expectations.

### **4.4. Continuous Integration (CI)**
- Integrate code changes frequently and use CI tools to automate tests, code analysis (e.g., SonarQube), and deployment processes.

---

## **5. Design Patterns**

### **5.1. Apply Common Design Patterns**
- Use design patterns when they simplify the code and enhance maintainability. Some patterns to use appropriately include:
  - **Singleton**: Ensure only one instance of a class is created.
  - **Factory**: For creating objects where the exact class may vary.
  - **Observer**: For allowing objects to notify other objects when changes occur.
  - **Strategy**: Encapsulate algorithms and make them interchangeable.
  - **Decorator**: Add behavior to objects dynamically.

### **5.2. Avoid Anti-Patterns**
- **God Object**: Don’t create classes that do everything. They become hard to maintain and reason about.
- **Spaghetti Code**: Avoid tangled and unstructured control flows that make the code difficult to follow.

---

## **6. Software Architecture Guidelines**

### **6.1. Layered Architecture**
- Organize your codebase using a layered architecture (e.g., Presentation, Business Logic, Data Access). Each layer should have well-defined responsibilities, and dependencies should flow in one direction (from higher-level layers to lower ones).

### **6.2. Separation of Concerns**
- **Modules and Layers**: Ensure that each module or layer focuses on one responsibility. This improves maintainability, testing, and scalability.
  
### **6.3. Microservices (if applicable)**
- If building a microservices-based architecture, keep services small, loosely coupled, and independently deployable. Each service should own its data and be responsible for its own logic.

### **6.4. Event-Driven Architecture**
- Use an event-driven architecture when appropriate, particularly for systems that require loose coupling, scalability, and asynchronicity. Prefer message brokers (e.g., Kafka, RabbitMQ) over direct service-to-service communication when decoupling is needed.

---

## **7. Code Reviews**

### **7.1. Peer Code Reviews**
- All code should go through peer review. Reviews should focus on code readability, maintainability, adherence to best practices, and test coverage.
- **Constructive Feedback**: Provide clear and constructive feedback. Reviews should help the author improve and lead to better code quality overall.

---

## **8. Documentation**

### **8.1. Code Documentation**
- **Function Documentation**: Each function should have a concise docstring explaining its purpose, parameters, and return values.
  - Example:
    ```python
    def calculateTax(price, rate):
        """
        Calculate the tax for a given price.

        :param price: The base price of the product
        :param rate: The tax rate as a decimal (e.g., 0.2 for 20%)
        :return: The tax amount
        """
        ```

### **8.2. Architecture Documentation**
- Keep architecture diagrams and system documentation up-to-date. Use tools like UML or C4 diagrams to visualize the system structure and component interactions.

