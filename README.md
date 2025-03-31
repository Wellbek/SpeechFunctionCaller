# Speech Function Caller

This tool is part of my bachelor thesis at the Software Engineering Group at RWTH Aachen University. It enables hands-free voice control of web applications, originally developed to improve EV battery disassembly documentation workflows in MontiGem-generated web applications for the DemoRec project of the RWTH Aachen University's Chair of Production Engineering of E-Mobility Components. By transforming spoken commands into executable browser actions, it eliminates the need for workers to alternate between physical tasks and manual data entry.

### Key Features

- Hands-free interaction with web interfaces
- Speech recognition effective in industrial environments
- Real-time command processing with minimal latency
- High accuracy even in noisy environments (93.34% accuracy in function resolution under high background noise)
- No misfires even with ambiguous fully natural voice commands
- Built on Azure OpenAI services, Whisper, and GPT-4o with function calling capabilities

### Impact

- Streamlines documentation processes in industrial settings
- Increases workflow efficiency and reduces operational disruptions
- Maintains high data entry accuracy (100% function resolution with explicit commands)
- Designed for adaptability across various web applications and tech-stacks beyond the initial use case

### Use Cases

The framework's versatility extends beyond its original EV battery recycling application. The technology shows promise across numerous domains where hands-free interaction provides significant advantages:

- **Industrial Environment**: Facilitates hands-free documentation during various operational processes
- **Healthcare**: Allows medical professionals to update records while maintaining sterile environments
- **Accessibility**: Provides alternative interaction methods for users with mobility limitations
- **Smart Home**: Simplifies control of web-based home automation interfaces
- **Automotive**: Improves safety through hands-free digital interaction
- **Education & Training**: Creates more engaging learning experiences through voice interaction

## Installation

### Prerequisites

- An existing project with separate frontend and backend
- Java 11 (check it with `java -version`)
- Gradle 7.6.4 (check it with `gradle --version`) - older versions may lead to an error with the dependencies

---

### Step 1: Clone The Project Into Your Existing Application

### Step 2: Frontend Integration

1. **Add your frontend as a dependency**:

    ```bash
    cd existing-project/frontend
    npm install --save ../speechfunctioncaller/frontend
    ```

2. **Import and use in TypeScript code**: In your existing project's frontend code, import and utilize the component:
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
    Adjust the path to point to the backend subdirectory of the tool.

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

## Step 4 (OPTIONAL): Spring Boot WebSocket Setup
In order to use the Spring Boot WebSocket, you need to configure the `AudioWebSocketConfig` and `AudioWebSocketHandler` as beans in your backend configuration. These classes are located in the `speechfunctioncaller/service` folder of the backend directory.

1. **Create a configuration class to register the WebSocket handlers:** You need to create a new class (e.g., `ExternalServiceConfig.java`) in the backend `src/main/java` directory to explicitly declare the `AudioWebSocketConfig` and `AudioWebSocketHandler` as beans. Here's how you can do it:
    ```java
    import org.springframework.context.annotation.Bean;
    import org.springframework.context.annotation.Configuration;
    import speechfunctioncaller.service.AudioWebSocketConfig;
    import speechfunctioncaller.service.AudioWebSocketHandler;
    
    @Configuration
    public class ExternalServiceConfig {
    
        @Bean
        public AudioWebSocketConfig audioWebSocketConfig() {
            return new AudioWebSocketConfig();
        }
    
        @Bean
        public AudioWebSocketHandler audioWebSocketHandler() {
            return new AudioWebSocketHandler();
        }
    }
    ```
2. **Alternative:** If you want the WebSocket configuration to be automatically discovered, ensure that `AudioWebSocketConfig` and `AudioWebSocketHandler` are properly scanned by Spring Boot. This can be done via the `@ComponentScan` annotation, or by placing these classes in a package that's already scanned by Spring Boot.

## Step 5: Build and Run

1. **Build both frontend and backend**:
    ```bash
    cd existing-project
    cd frontend && npm run build
    cd ../backend && ./gradlew build
    ```

2. **Start your existing application normally**.

This will integrate your speech tool into your existing project, enabling both frontend and backend functionalities to work seamlessly together.

---

## Basic Setup Process

### For Regular Users

To integrate the tool into an existing project, follow these steps:

1. **Define Communication Handler**
   - Implement the `CommunicationHandler` interface to establish the protocol between frontend and backend
   - Example:
   ```typescript
   class MyCommHandler implements CommunicationHandler {
     async sendData(data: string): Promise<any> {
       // Your implementation for sending data to backend
     }
   }
   ```

2. **Register HTML Elements**
   - Implement the `ElementHandler` interface for each type of HTML element you want to make interactable
   - Example:
   ```typescript
   class TextFieldHandler implements ElementHandler {
     getLabel(root: HTMLElement): string {
       const label = root.querySelector("label");
       return label ? label.textContent?.trim() : "";
     }

     getElement(root: HTMLElement): HTMLElement | null {
       return root.querySelector("input") || null;
     }
   }
   ```

3. **Register Elements in Registry**
   - Add your element handlers to the `ElementRegistry`
   ```typescript
   ElementRegistry.registerHandler("text-field", new TextFieldHandler());
   ```

4. **Define Function Call Schemas**
   - Use the `@FunctionCall` decorator to define schemas for callable functions
   ```typescript
   @FunctionCall(function() {
     return {
       name: "setTextField",
       description: "Sets a value in a text field",
       parameters: {
         type: "object",
         properties: {
           textField: {
             type: "string",
             enum: SpeechFunctionCaller.getInstance().getAllElements("text-field"),
             description: "The text field to enter the value in"
           },
           value: {
             type: "string",
             description: "The text to enter inside the specified textfield"
           }
         },
         required: ["textField", "value"]
       }
     };
   })
   public setTextField(textField: string, value: string): void {
     // Implementation
   }
   ```

5. **Register Callback for Function Call Results**
   ```typescript
   SpeechFunctionCaller.getInstance().onFCComplete((functionCallResult) => {
     console.log("Function Call Result:", functionCallResult);
     this.handleFunctionCall(functionCallResult);
   });
   ```

6. **Initialize Communication**
   ```typescript
   SpeechFunctionCaller.getInstance().setCommunicationHandler(new MyCommHandler());
   
   // Optional: If using WebSockets for audio streaming
   SpeechFunctionCaller.getInstance().setAudioWebSocketHandler("ws://your-backend-url/audio-transcription");
   ```

7. **Set up Azure Credentials**
   ```typescript
   SpeechFunctionCaller.getInstance().setCredentials(
     ENDPOINT,
     TOKEN,
     TRANSCRIBER_MODEL,
     RESOLVER_MODEL
   );
   ```
   
8. **(OPTIONAL) Customize Function Resolution Keywords**
    - Call `SpeechFunctionCaller.getInstance().setCommandKeywords(["your", "custom", "keywords"])` to define when functions should be resolved.
    - By default, the list contains the keyword "submit".

9. **Invoke Speech Functions**
    - You can now initiate the capture process or submit queries for function resolution directly. Alternatively, you can achieve this by using the 'Start Capture' button in the tool's UI within the web browser. If one of the specified keywords is detected, queries will be automatically submitted for function resolution.
   ```typescript
   // To start speech capture
   SpeechFunctionCaller.getInstance().toggleCapture();
   
   // To submit collected speech for function calling
   SpeechFunctionCaller.getInstance().submitQuery();
   ```

### For MontiGem Users

MontiGem users can take advantage of the `MontiGemSFCUtilities` library for simplified setup:

1. **Import and Configure**
   ```typescript
   import { configureSpeechFunctionCaller } from 'MontiGemSFCUtilities';
   
   configureSpeechFunctionCaller({
     endpoint: this.ENDPOINT,
     token: this.TOKEN,
     transcriberModel: this.TRANSCRIBER_MODEL,
     resolverModel: this.RESOLVER_MODEL,
     clientId: "",
     audioWebHandler: "ws://localhost:8081/umlp/api/audio-transcription",
     context: this // Context where functions are executed
   });
   ```

2. **Define Function Calls Using Built-in Schemas**
   ```typescript
   import { FunctionCall, getTextFieldSchema } from 'MontiGemSFCUtilities';
   import { MontiGemSFCFunctions } from 'MontiGemSFCUtilities';
   
   @FunctionCall(getTextFieldSchema())
   public setTextField(textField: string, value: string): void {
     // Use the built-in implementation
     MontiGemSFCFunctions.setTextField(textField, value);
     
     // Optional: Add custom functionality
   }
   ```

## Angular Integration Example

For Angular applications (like DemoRec or other MontiGem-generated web applications), you can implement a dedicated service:

```typescript
@Injectable({
  providedIn: 'root'
})
export class SFCService {
  configure() {
    // Implement all configuration steps here
  }
}
```

Then inject and initialize in your main component:

```typescript
@Component({
  selector: 'app-root',
  // ...
})
export class AppComponent implements OnInit {
  constructor(private sfcService: SFCService) {}
  
  ngOnInit() {
    this.sfcService.configure();
  }
}
```

This approach ensures the speech functionality persists across component changes and page navigations.

---

## Troubleshooting

- Ensure all element handlers are registered before initializing the communication
- Verify Azure credentials are correct
- Check browser console for detailed error messages
- If defined, the WebSocket handler listens for audio data from the frontend and processes it for transcription. The WebSocket URL should match the one specified in your frontend configuration.
