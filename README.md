# Speech Function Caller

A tool for integrating voice control into web applications using LLMs

## Installation

## Prerequisites
- An existing project with separate frontend and backend

## Step 1: Clone The Project Into your Existing Application

## Step 2: Frontend Integration

1. **Add your frontend as a dependency**:
    ```bash
    cd existing-project/frontend
    npm install --save ../speechfunctioncaller/frontend
    ```

2. **Import and use in TypeScript code**:
    In your existing project's frontend code, import and utilize the component:
    ```typescript
    // In your existing project's frontend code
    import { SpeechFunctionCaller } from '../speechfunctioncaller/frontend/SpeechFunctionCaller';

    // Use the component
    ```
    Adjust the path to point to the correct frontend script.

## Step 3: Backend Integration

1. **Update `settings.gradle` in your existing project**:
    In your existing project's `settings.gradle`, add the following:
    ```gradle
    include ':speechfunctioncaller'
    project(':speechfunctioncaller').projectDir = new File('../speechfunctioncaller/backend')
    ```
    and correctly adjust the path to point to the backend subdirectory of the tool.

2. **Update `build.gradle` in your existing project**:
    Add the following dependency in the `dependencies` section:
    ```gradle
    dependencies {
      // Other dependencies...
      implementation project(':speechfunctioncaller')
    }
    ```

3. **Import and use in Java code**:
    In your existing project's Java code, import and use the components:
    ```java
    // In your existing project's Java code
    import speechfunctioncaller.Transcriber;
    import speechfunctioncaller.FunctionResolver;
    import speechfunctioncaller.InstanceManager;
    import speechfunctioncaller.DataProcessor;

    // Use the components
    ```

## Step 4: Build and Run

1. **Build both frontend and backend**:
    ```bash
    cd existing-project
    cd frontend && npm run build
    cd ../backend && ./gradlew build
    ```

2. **Start your existing application normally**.

This will integrate your speech tool into your existing project, enabling both frontend and backend functionalities to work seamlessly together.
