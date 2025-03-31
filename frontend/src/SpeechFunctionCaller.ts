/**
 * @fileoverview Use this script to configure, manage, and envoke backend function calling and speech transcription
 *
 * How to use:
 * 1. Define communication with backend by implementing the CommunicationHandler
 * 2. Register visible HTMLElements by implementing ElementHandlers
 * 3. Add Elements from 2. to the ElementRegistry
 * 4. Add Decorator to callable functions and define their Schema
 * 5. Register a callback to handle the JSON function call result
 *  e.g.:
    SpeechFunctionCaller.getInstance().onFCComplete((functioncallresult) => {
      console.log("Function Call Result: ", functioncallresult)
      this.handleFunctionCall(functioncallresult)
    });
 * ======== Atfer all HTML Elements are initialized ====================
 * 6. Call SpeechFunctionCaller.getInstance().setCommunicationHandler with your created Handler,
 * 6.1 (OPTIONAL): If WebSockets and SpringBoot are supported, you can specify the URL of the WebSocketCommunicationHandler to enable audio streaming
 * 7. Initialize AZURE Client with setCredentials(this.ENDPOINT, this.TOKEN, this.TRANSCRIBER_MODEL, this.RESOLVER_MODEL)
 * 8. Call SpeechFunctionCaller.getInstance().toggleCapture() and/or ...submitQuery() whereever you need them
 * 
 * @author Louis Wellmeyer
 * @date March 31, 2025
 * @license CC BY
 */

/**
 * Decorator that automatically registers tool schema functions
 * @param {function} schemaGenerator Function that generates a tool's JSON schema based on this format https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/function-calling.
 *      Since the parameter is a function and we evaluate the JSON only later, you can add functions inside the JSONs to be executed on read (see example "enum")
 * @returns {function} Decorator function that processes and stores the schema
 *
 * Example:
    *```
    @FunctionCall(
        function () {
            return {
            name: "setTextField",
            description: "Sets the given value into the textfield of name provided by the textField parameter.",
            parameters: {
                type: "object",
                properties: {
                    textField: {
                        type: "string",
                        enum: SpeechFunctionCaller.getInstance().getAllElements("gem-text-input"),
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
    public setTextField(textField: string, value: string): void {...}``` 
    *
    */
    export function FunctionCall(schemaGenerator: () => any) {
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): void {
            // Store the original method to ensure its not overwritten by the decorator
            const originalMethod = descriptor.value;

            // Check if the target already has a __schemas__ property to store schemas
            if (!target.__schemas__) {
                target.__schemas__ = {};
            }

            // Store the schemaGenerator function in the __schemas__ of the target using propertyKey as the key
            target.__schemas__[propertyKey] = schemaGenerator;

            try {
                // Store the unevaluated schema generator (not the result of the function)
                SpeechFunctionCaller.getInstance().addToolSchema(schemaGenerator);
            } catch (e) {
                console.error("Error adding schema:", e);
            }

            // Restore the original method so that the decorator does not change its behaviour
            descriptor.value = originalMethod;
        };
    }

    /**
     * Interface defining communication protocol between frontend and backend.
     * As of right now, data is always supposed to be sent and handled as a JSON string.
     *
     * Example call:
     * 
     *  ```this.sendDataToHandler(JSON.stringify({
            "class": "FunctionResolver"
            "function": "setCredentials",
            "parameters": [endpoint, token, resolver_model]
        }));
        ```
     *
     * @returns {void}
     */
    export interface CommunicationHandler {
        sendData(data: string): Promise<any>;
    }

    /**
     * Interface defining methods for handling HTML elements
     * Each Element consists of :
     *  1. The Element itself (root) to register
     *  2. The actual HTMLElement to manipulate/read from
     *  3. A Label that can be used by the LLM to decide if/what HTMLElement to select
     *
     * Example:
     *  ```class GemTextInputHandler implements ElementHandler {
            getLabel(root: HTMLElement): string {
                const label = root.querySelector("label");
                return label ? label.textContent?.trim() : "";
            }

            getElement(root: HTMLElement): HTMLElement | null {
                return root.querySelector("input") || null;
            }
        }
        ```
     */
    export interface ElementHandler {
        // Method to get the label of an element
        getLabel(root: HTMLElement): string | null;

        // Method to get the element to manipulate
        getElement(root: HTMLElement): HTMLElement | null;
    }

    /**
     * Registry for ElementHandlers
     */
    export class ElementRegistry {
        private static handlers: Map<string, ElementHandler> = new Map();
    
        // Method to register a new handler
        static registerHandler(type: string, handler: ElementHandler): void {
            this.handlers.set(type, handler);
        }
    
        // Method to get a handler for a specific type
        static getHandler(type: string): ElementHandler | null {
            return this.handlers.get(type) || null;
        }
    
        // Method to get all registered types
        static getAllTypes(): string[] {
            return Array.from(this.handlers.keys());
        }
    }

    /**
     * WebSocketCommunicationHandler is an optional handler that enables real-time audio streaming 
     * via WebSocket for efficient low-latency communication. Instead of relying on polling mechanisms, 
     * this class allows direct transmission of binary audio data while receiving immediate feedback 
     * from the server.
     */
    export class WebSocketCommunicationHandler {
        private socket: WebSocket;
        private isConnected: boolean = false;
        private messageQueue: string[] = [];
        private reconnectAttempts: number = 0;
        private maxReconnectAttempts: number = 5;
        private reconnectDelay: number = 1000;
        private onTranscriptionCallback: (transcription: string) => void;

        /**
         * Initializes a new WebSocketCommunicationHandler instance.
         * 
         * @param {string} wsUrl - WebSocket server URL.
         * @param {string} clientId - Unique client identifier for instance matching in the backend.
         * @param {function} onTranscription - Callback function to handle received transcription data.
         * @returns {void}
         */
        constructor(private wsUrl: string, private clientId: string, onTranscription: (transcription: string) => void) {
            this.onTranscriptionCallback = onTranscription;

            if (wsUrl){
                this.socket = this.createWebSocket();
            } else {
                console.log("ERROR: wsUrl is empty, undefined, or null. Failed to create WebSocket.")
            }
        }

        /**
         * Creates a new WebSocket connection.
         * 
         * @returns {WebSocket} The initialized WebSocket instance.
         */
        private createWebSocket(): WebSocket {
            const socketUrl = `${this.wsUrl}?clientId=${this.clientId}`; // Append clientId as a query parameter to retrieve the appropriate client instances on the backend
        
            const socket = new WebSocket(socketUrl);

            socket.onopen = () => {
                console.log("WebSocket connection established");
                this.isConnected = true;

                // Send any queued messages upon successful connection
                while (this.messageQueue.length > 0) {
                    const message = this.messageQueue.shift();
                    if (message) this.socket.send(message);
                }
                this.reconnectAttempts = 0;
            };

            socket.onclose = (event) => {
                console.log("WebSocket connection closed", event);
                this.isConnected = false;
                this.attemptReconnect();
            };

            socket.onerror = (error) => {
                console.error("WebSocket error:", error);
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.transcription !== undefined) {
                        console.log('Received transcription from WebSocket:', data.transcription);
                        this.onTranscriptionCallback(data.transcription); // Suffices to just sent transcription as in the case of websocket the transcription is always finished
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            return socket;
        }

        /**
         * Attempts to reconnect the WebSocket connection with an increasing delay.
         * Stops retrying after reaching the maximum number of attempts.
         * 
         * @returns {void}
         */
        private attemptReconnect() {
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                setTimeout(() => {
                    this.socket = this.createWebSocket();
                }, this.reconnectDelay * this.reconnectAttempts);
            } else {
                console.error("Max reconnection attempts reached");
            }
        }

        /**
         * Sends binary audio data via WebSocket if connected.
         * 
         * @param data - The binary audio data to send.
         * @returns {void}
         */
        sendBinaryData(data: ArrayBuffer) {
            if (!this.isConnected) {
                console.warn("WebSocket not connected, cannot send binary data");
                return;
            }

            try {
                this.socket.send(data);
            } catch (error) {
                console.error("Error sending binary data:", error);
            }
        }
    }

    /**
     * AudioController is a UI component that provides an interface for controlling and monitoring 
     * audio input. It allows users to adjust the audio input sensitivity using a threshold slider, 
     * visualize audio energy levels through a meter, and toggle the start/stop of the audio recording process.
     * The component also allows for resetting the audio capture process.
     */
    class AudioController {
        private container: HTMLElement;
        private sliderElem: HTMLInputElement;
        private meterElem: HTMLInputElement;
        private meterWrapper: HTMLElement;
        private currentEnergy: number = 0;
        private threshold: number = 15000;
        private captureButton: HTMLButtonElement;
        private resetButton: HTMLButtonElement;
        private isCapturing: boolean = false;
    
        /**
         * Initializes the AudioController by creating the necessary HTML elements for the UI.
         * Sets up event listeners for interactions such as adjusting the threshold and toggling 
         * the capture button.
         */
        constructor() {
            this.container = document.createElement("div");
            this.container.className = "audio-control";
            this.container.style.position = "fixed";
            this.container.style.bottom = "10px";
            this.container.style.left = "10px";
            this.container.style.padding = "10px";
            this.container.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
            this.container.style.boxShadow = "0 4px 10px rgba(0, 0, 0, 0.4)";
            this.container.style.borderRadius = "8px";
            this.container.style.display = "flex";
            this.container.style.flexDirection = "column";
            this.container.style.gap = "5px";
            this.container.style.width = "200px";
    
            // Threshold slider
            this.sliderElem = document.createElement("input");
            this.sliderElem.type = "range";
            this.sliderElem.min = "0";
            this.sliderElem.max = "50000";
            this.sliderElem.step = "100";
            this.sliderElem.value = this.threshold.toString();
            this.sliderElem.className = "audio-slider";
            this.sliderElem.addEventListener("input", () => this.updateThreshold());
    
            // Meter wrapper
            this.meterWrapper = document.createElement("div");
            this.meterWrapper.style.height = "10px";
            this.meterWrapper.style.backgroundColor = "rgba(0, 255, 0, 0.8)";
    
            // Meter element (hidden but updates value)
            this.meterElem = document.createElement("input");
            this.meterElem.type = "range";
            this.meterElem.min = "0";
            this.meterElem.max = "50000";
            this.meterElem.step = "100";
            this.meterElem.value = "0";
            this.meterWrapper.style.width = "0";
            this.meterElem.className = "audio-meter";
            this.meterElem.disabled = true;
            this.meterElem.style.display = "none";
    
            // Toggle capture button
            this.captureButton = document.createElement("button");
            this.captureButton.textContent = "Start Capture";
            this.captureButton.style.padding = "8px";
            this.captureButton.style.marginTop = "10px";
            this.captureButton.style.backgroundColor = "rgba(76, 175, 80, 1)";
            this.captureButton.style.color = "white";
            this.captureButton.style.border = "none";
            this.captureButton.style.borderRadius = "4px";
            this.captureButton.style.cursor = "pointer";
            this.captureButton.style.fontWeight = "bold";
            this.captureButton.addEventListener("click", () => this.toggleCapture());
            
            // Reset button
            this.resetButton = document.createElement("button");
            this.resetButton.textContent = "Reset";
            this.resetButton.style.padding = "8px";
            this.resetButton.style.marginTop = "5px";
            this.resetButton.style.backgroundColor = "rgba(220, 53, 69, 1)";
            this.resetButton.style.color = "white";
            this.resetButton.style.border = "none";
            this.resetButton.style.borderRadius = "4px";
            this.resetButton.style.cursor = "pointer";
            this.resetButton.style.fontWeight = "bold";
            this.resetButton.addEventListener("click", () => this.reset());
    
            this.meterWrapper.appendChild(this.meterElem);
            this.container.appendChild(this.sliderElem);
            this.container.appendChild(this.meterWrapper);
            this.container.appendChild(this.captureButton);
            this.container.appendChild(this.resetButton);
            document.body.appendChild(this.container);
        }
    
        /**
         * Updates the audio energy meter based on the given audio energy level.
         * Adjusts the meter's visual width and color dynamically according to the energy value.
         * If the energy level exceeds the threshold, the meter turns green; otherwise, it turns red.
         * @param {number} audioEnergy - The current energy level of the audio input.
         * @returns {void}
         */
        public updateMeter(audioEnergy: number) {
            this.currentEnergy = audioEnergy;
            this.meterElem.value = this.currentEnergy.toString();
    
            const widthPercentage = (this.currentEnergy / 50000) * 100;
            this.meterWrapper.style.width = `${widthPercentage}%`;
    
            // Update meter color dynamically
            this.meterWrapper.style.backgroundColor = this.currentEnergy >= this.threshold ? "rgb(33, 168, 37)" : "rgb(182, 37, 27)";
        }
    
        /**
         * Updates the threshold value based on the slider input. 
         * This value determines the sensitivity of the audio capture.
         * 
         * @returns {void}
         */
        private updateThreshold() {
            this.threshold = parseInt(this.sliderElem.value);
        }
    
        /**
         * Returns the current sensitivity threshold value for the audio input.
         * 
         * @returns {number} The current threshold value.
         */
        public getThreshold(): number {
            return this.threshold;
        }
    
        /**
         * Toggles the start/stop state of audio capture.
         * Changes the button text and color accordingly.
         * When activated, it calls the SpeechFunctionCaller to start or stop recording.
         * 
         * @returns {void}
         */
        public toggleCapture() {
            this.isCapturing = !this.isCapturing;
    
            if (this.isCapturing) {
                this.captureButton.textContent = "Stop Capture";
                this.captureButton.style.backgroundColor = "rgba(244, 67, 54, 1)";
            } else {
                this.captureButton.textContent = "Start Capture";
                this.captureButton.style.backgroundColor = "rgba(76, 175, 80, 1)";
            }
    
            SpeechFunctionCaller.getInstance().toggleCapture();
        }

        /**
         * Resets the audio capture process, clearing any captured data and resetting the audio energy meter.
         * 
         * @returns {void}
         */
        private reset() {
            SpeechFunctionCaller.getInstance().reset();

            this.currentEnergy = 0;
            this.updateMeter(0);
        }
    }

    /**
     * Manages the status messages and message history displayed to the user.
     * This class provides functionality to show various types of messages (processing, success, info, error)
     * and keeps a history of the last few messages.
     * 
     * It helps provide transparency to the user, especially for backend and LLM (Large Language Model) executions.
     * Transparency is crucial to build trust with users and help them understand what the application is doing, 
     * especially when dealing with complex processes like AI/ML model executions.
     */
    class StatusManager {
        private statusElement: HTMLElement | null = null;
        private messageHistoryElement: HTMLElement | null = null;
        private containerElement: HTMLElement | null = null;
        private messageHistory: string[] = [];
        private maxHistoryLength: number = 5;
    
        /**
         * Constructor initializes the status manager by creating the status display elements.
         */
        constructor() {
            this.createStatusElements();
        }
    
        /**
         * Creates and sets up the HTML elements for the status display and message history.
         * 
         * @returns {void}
         */
        private createStatusElements() {
            if (!this.statusElement) {
                const container = document.createElement("div");
                container.style.position = "fixed";
                container.style.bottom = "160px";
                container.style.left = "10px";
                container.style.width = "300px";
                container.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
                container.style.borderRadius = "8px";
                container.style.padding = "10px";
                container.style.fontFamily = "Arial, sans-serif";
                container.style.fontSize = "14px";
                container.style.zIndex = "1000";
                container.style.display = "none";
                container.style.color = "white";
                container.style.boxShadow = "0 4px 10px rgba(0, 0, 0, 0.4)";
                document.body.appendChild(container);
    
                this.statusElement = document.createElement("div");
                this.statusElement.style.marginBottom = "5px";
                this.statusElement.style.padding = "5px";
                this.statusElement.style.borderRadius = "4px";
                this.statusElement.style.fontWeight = "bold";
                container.appendChild(this.statusElement);
    
                this.messageHistoryElement = document.createElement("div");
                this.messageHistoryElement.style.maxHeight = "150px";
                this.messageHistoryElement.style.overflowY = "auto";
                this.messageHistoryElement.style.fontSize = "12px";
                this.messageHistoryElement.style.borderTop = "1px solid rgba(255, 255, 255, 0.3)";
                this.messageHistoryElement.style.paddingTop = "5px";
                container.appendChild(this.messageHistoryElement);
    
                this.containerElement = container;
            }
        }
    
        /**
         * Displays a "Processing audio..." message to the user, indicating that an operation is still in progress.
         * 
         * @returns {void}
         */
        public showProcessing() {
            if (!this.statusElement) this.createStatusElements();
            if (this.statusElement && this.containerElement) {
                this.statusElement.textContent = "Processing audio...";
                this.statusElement.style.backgroundColor = "rgba(255, 193, 7, 0.7)"; 
                this.statusElement.style.color = "rgba(0, 0, 0, 0.9)"; 
                this.containerElement.style.display = "block";
            }
        }
    
        /**
         * Displays a success message to the user. It is used to indicate a successful operation like finished transcription or received function call JSON.
         * 
         * @param {string} message - The success message to display.
         * @returns {void}
         */
        public showSuccess(message: string) {
            if (!this.statusElement) this.createStatusElements();
            if (this.statusElement && this.containerElement) {
                this.statusElement.textContent = message;
                this.statusElement.style.backgroundColor = "rgba(40, 167, 69, 0.7)"; 
                this.statusElement.style.color = "white";
                this.containerElement.style.display = "block";
            }
        }
    
        /**
         * Displays an informational message to the user. This is typically used for general information 
         * or updates during operations, like indicating crucial progress steps or feedback.
         * 
         * @param {string} message - The message to display.
         * @returns {void}
         */
        public showInfo(message: string) {
            if (!this.statusElement) this.createStatusElements();
            if (this.statusElement && this.containerElement) {
                this.statusElement.textContent = message;
                this.statusElement.style.backgroundColor = "rgba(23, 162, 184, 0.7)"; 
                this.statusElement.style.color = "white";
                this.containerElement.style.display = "block";
    
                this.addToHistory(message);
            }
        }
    
        /**
         * Displays an error message to the user. This is used to report failures or problems in processing.
         * It helps users identify issues in configuration, with the backend, or other parts of the system.
         * 
         * @param {string} message - The error message to display.
         * @returns {void}
         */
        public showError(message: string) {
            if (!this.statusElement) this.createStatusElements();
            if (this.statusElement && this.containerElement) {
                this.statusElement.textContent = message;
                this.statusElement.style.backgroundColor = "rgba(220, 53, 69, 0.7)";
                this.statusElement.style.color = "white";
                this.containerElement.style.display = "block";
    
                this.addToHistory(`ERROR: ${message}`);
            }
        }
    
        /**
         * Logs a message to the message history without affecting the current status display.
         * 
         * @param {string} message - The message to log.
         * @returns {void}
         */
        public logMessage(message: string) {
            this.addToHistory(message);
        }
    
        /**
         * Adds a message to the history and updates the history display.
         * 
         * @param {string} message - The message to add to the history.
         * @returns {void}
         */
        private addToHistory(message: string) {
            if (!this.messageHistoryElement) return;
    
            const timestamp = new Date().toLocaleTimeString();
            const formattedMessage = `[${timestamp}] ${message}`;
    
            this.messageHistory.unshift(formattedMessage);
            if (this.messageHistory.length > this.maxHistoryLength) {
                this.messageHistory.pop();
            }
    
            this.updateHistoryDisplay();
        }
    
        /**
         * Updates the message history display to show the most recent messages.
         * 
         * @returns {void}
         */
        private updateHistoryDisplay() {
            if (!this.messageHistoryElement) return;
    
            this.messageHistoryElement.innerHTML = '';
            this.messageHistory.forEach(msg => {
                const msgElement = document.createElement("div");
                msgElement.textContent = msg;
                msgElement.style.padding = "3px 0";
                msgElement.style.borderBottom = "1px solid rgba(255, 255, 255, 0.3)";
                this.messageHistoryElement.appendChild(msgElement);
            });
        }
    
        public hide() {
            if (this.containerElement) {
                this.containerElement.style.display = "none";
            }
        }
    }

    /**
     * Interface for audio chunk data structure
     */
    interface AudioChunk {
        sequence: string; // Order of the chunk in the sequence
        data: string; // Base64 encoded audio data
        end: boolean; // Flag indicating if this is the final chunk
    }

    interface TranscriptionStatus {
        status: boolean;
        transcription: string;
    }

    /**
     * Main class as a frontend entry-point for backend speech transcription, function calling, ...
     * 
     * Singleton pattern: as there ever only needs to be one instance per client and we have global states
     */
    export class SpeechFunctionCaller {
        private MAX_CHUNK_SIZE = 512 * 1024; // 512 KB
        private CHUNK_SIZE = 5000; // Max number of chars each packet sent via Base64 can contain

        private static instance: SpeechFunctionCaller;
        private elementMap = new Map<string, Map<string, HTMLElement>>();  // {TYPE : {LABEL : HTMLElement}}
        private toolSchemas: (() => any)[] = []; // Stores schema generator functions, not their results. To get results just call the generator and stringify to JSON

        private capturing = false // Flag to indicate if audio is currently being captured

        private mediaRecorder: MediaRecorder | null = null;
        private audioChunks: Blob[] = []; // Audio chunks captured during recording
        private audioContext: AudioContext; 

        private communicationHandler: CommunicationHandler | null = null; // Communication handler used to communicate with the backend and evoke backend logic
        private audioWebHandler: WebSocketCommunicationHandler | null = null; // (Optional) WebSocket handler for audio-specific communication with the backend for higher efficiency

        private chunkInterval: number = 1000; // Interval time in milliseconds for chunk processing
        private chunkIntervalId: number | null = null;
        private lastTranscription: string = ''; // The most recent transcription result to display information and compare to new incoming transcriptions
        private backoffDelay: number = 1000; // Polling backoff interval
        private maxDelay: number = 10000; // Maximum polling interval in milliseconds
        private minDelay: number = 1000; // Minimum polling interval in milliseconds
        private isPolling: boolean = false;
        private commandKeywords: string[] = ["submit"]; // List of command keywords to look for in transcriptions (e.g., "submit")

        // Callback function for handling the function calling results
        private fcCallback: ((transcription: string) => void) | null = null;

        private isProcessing: boolean = false;
        private processingQueue: Blob[] = []; // queue to store chunks waiting to be processed

        private audioController = new AudioController();
        private statusManager = new StatusManager();

        // Singleton pattern: always only one instance
        public static getInstance(): SpeechFunctionCaller {
            if (!SpeechFunctionCaller.instance) {
                SpeechFunctionCaller.instance = new SpeechFunctionCaller();
            }
            return SpeechFunctionCaller.instance;
        }

        /**
         * Sets the communication handler for backend interaction
         * 
         * @param {CommunicationHandler} handler Implementation of CommunicationHandler interface
         * @returns {void}
         */
        public setCommunicationHandler(handler: CommunicationHandler) {
            this.communicationHandler = handler;
        }

        /**
         * Sets the audio handler for streaming audio data
         * 
         * @param {string} url local url where the audio is sent to
         * @returns {void}
         */
        public setAudioWebHandler(url: string, clientId: string) {
            this.audioWebHandler = new WebSocketCommunicationHandler(url, clientId, (transcription) => {
                if (transcription !== this.lastTranscription) {
                    this.lastTranscription = transcription;
                    this.handleTranscriptionUpdate({
                        transcription: transcription,
                        status: this.processingQueue.length > 0 // Still processing if queue has items
                    });
                }
            });

            console.log("WebSocket handler initialized");
        }

        /**
         * Configures credentials for backend AZURE service where transcriber model and resolver resides
         * 
         * @param {string} endpoint AZURE service URL
         * @param {string} token AZURE Authentication token
         * @param {string} transcriber_model Model for speech transcription
         * @param {string} resolver_model Model for function resolution
         * @returns {void}
         */
        public async setCredentials(endpoint: string, token: string, transcriberModel: string, resolverModel: string) {
            await this.sendDataToHandler(JSON.stringify({
                "class": "FunctionResolver",
                "function": "setCredentials",
                "parameters": [endpoint, token, resolverModel]
            }));

            await this.sendDataToHandler(JSON.stringify({
                "class": "Transcriber",
                "function": "setCredentials",
                "parameters": [endpoint, token, transcriberModel]
            }));

            this.statusManager.showInfo("Credentials set for Azure services");
        }

        /**
         * Sends data to the backend via communication handler with the custom configuration to interact with backend
         * 
         * @param {string} data String data to send
         * @returns {any} Response from backend
         */
        public sendDataToHandler(data: string): any {
            if (this.communicationHandler) {
                return this.communicationHandler.sendData(data);
            } else {
                const errorMsg = "No communication handler set";
                this.statusManager.showError(errorMsg);
                console.error(errorMsg);
            }
        }

        /**
         * Initializes DOM elements for tool interaction
         * 
         * @returns {void}
         */
        public initDOMs() {
            // Get all registered element types
            const elementTypes = ElementRegistry.getAllTypes();

            elementTypes.forEach(type => {
                // Get the handler for the element type from the registry
                const handler = ElementRegistry.getHandler(type);

                if (handler) {
                    // Find all root elements of the given type
                    const elements = document.querySelectorAll<HTMLElement>(type);

                    if (!this.elementMap.has(type)) {
                        this.elementMap.set(type, new Map<string, HTMLElement>());
                    }

                    elements.forEach(element => {
                        // Use the handler's custom logic to get the element to manipulate
                        const customElement = handler.getElement(element);

                        if (customElement) {
                            // Retrieve the label using the handler's method
                            const labelText = handler.getLabel(element) || "Unnamed Element";  

                            // Store the element in the map with its label as the key
                            this.elementMap.get(type)?.set(labelText, customElement);
                        }
                    });
                }
            });

            console.log(this.elementMap);
        }

        /**
         * Prepares for function calling by equipping the FunctionResolver with the callable tools created from the toolSchemas
         * 
         * @returns {Promise<void>}
         */
        public async setUpResolver() {
            // reset tools
            await this.sendDataToHandler(JSON.stringify({
                "class": "FunctionResolver",
                "function": "resetTools",
                "parameters": []
            }));

            // Get the HTML Elements (they might have changed)
            this.initDOMs();

            // add all tools
            const schemas = await this.getToolSchemas();
            console.log(schemas);
            for (const schema of schemas) {
              try {
                await this.sendDataToHandler(JSON.stringify({
                    "class": "FunctionResolver",
                    "function": "addTool",
                    "parameters": [schema]
                }));
              } catch (error) {
                console.error("Error adding tool schema:", error);
              }
            }
        }

         /**
         * Submits query for function resolution
         * 
         * @returns {Promise<string>} Resolution result as string
         */
        public async submitQuery(): Promise<string> {
            this.statusManager.showInfo("Submitting query for function resolution");
            return await this.sendDataToHandler(JSON.stringify({
                "class": "FunctionResolver",
                "function": "resolveFunctions",
                "parameters": []
            }));
        }

        /**
         * Starts continuous audio recording and processing.
         * This function starts recording audio, displays status messages to the user, and continuously processes audio chunks.
         * It sets up an interval to slice the audio data into manageable chunks, checks for silence, and processes only non-silent chunks.
         * If the audio is not being transmitted via WebSocket, it triggers polling with a backoff mechanism to get transcription updates.
         * 
         * @returns {Promise<void>}
         */
        public async startContinuousRecording() {
            try {
                await this.startRecording();
                this.statusManager.showInfo("Recording started successfully");
                console.log("Recording started successfully");

                // Keep track of how much audio we've processed for slicing
                let lastProcessedTime = 0;

                this.chunkIntervalId = window.setInterval(async () => {
                    if (!this.capturing || this.audioChunks.length === 0) return;

                    // Only start backoff polling if we're not using WebSockets
                    if (!this.audioWebHandler) {
                        this.isPolling = true;
                        this.pollWithBackoff();
                    }

                    // console.log("Processing audio chunk...");
                    try {
                        // Create WebM blob with all chunks to maintain header validity
                        const webmBlob = new Blob(this.audioChunks, { type: "audio/webm" });
                        const audioBuffer = await this.audioContext.decodeAudioData(await webmBlob.arrayBuffer());
                        const audioBlob = await this.convertToWAV(audioBuffer, lastProcessedTime);

                        if (audioBlob) {
                            // check for silence before adding to queue
                            const buffer = await audioBlob.arrayBuffer();
                            const bytes = new Uint8Array(buffer);

                            if (!this.isSilence(bytes)) {
                                this.processingQueue.push(audioBlob);
                                // Start processing immediately if not already processing
                                if (!this.isProcessing) {
                                    this.processQueue();
                                }
                            }

                            lastProcessedTime = audioBuffer.duration;
                        }
                    } catch (error) {
                        const errorMsg = "Error in audio processing cycle";
                        this.statusManager.showError(errorMsg);
                        console.error(errorMsg, error);
                    }
                }, this.chunkInterval);
            } catch (error) {
                const errorMsg = "Failed to start recording";
                this.statusManager.showError(errorMsg);
                console.error(errorMsg, error);
            }
        }

        /**
         * Polls transcription updates with a backoff strategy.
         * This function continuously sends a request to the transcription handler to check if there are any new transcriptions.
         * If a new transcription is found, it handles the update. If no change is found, the backoff delay is increased to reduce 
         * the frequency of polling. In case of an error, the maximum backoff delay is used, and the process continues at the next interval.
         * 
         * @returns {Promise<void>}
         */
        private async pollWithBackoff() {
            if (!this.isPolling) return; // Stop if polling is disabled

            try {
                const response = await this.sendDataToHandler(JSON.stringify({
                    "class": "Transcriber",
                    "function": "transcribe",
                    "parameters": []
                }));

                const status = JSON.parse(response) as TranscriptionStatus;

                if (status.transcription !== this.lastTranscription) {
                    // New transcription found
                    this.lastTranscription = status.transcription;
                    this.backoffDelay = this.minDelay; // Reset delay
                    this.handleTranscriptionUpdate(status);
                } else {
                    // No changes => increase backoff
                    this.backoffDelay = Math.min(this.backoffDelay * 1.05, this.maxDelay);
                    // console.log(this.backoffDelay);
                }
            } catch (error) {
                const errorMsg = "Error checking transcription";
                this.statusManager.showError(errorMsg);
                console.error(errorMsg, error);
                this.backoffDelay = this.maxDelay; // on error use max delay
            }

            // Schedule next poll if still polling
            if (this.isPolling) {
                window.setTimeout(() => this.pollWithBackoff(), this.backoffDelay);
            }
        }

        /**
         * Handles the update of transcription by logging the new transcription for user feedback and triggering actions based on the transcription content.
         * If there are no items in the processing queue, the status is updated to indicate that transcription is complete. 
         * If any keywords are detected in the transcription, it triggers the handling of commands by submitting for function resolution.
         * If the processing queue still has items, it shows that processing is still ongoing.
         *
         * @param {TranscriptionStatus} status - The current status of the transcription, which contains the transcription text and if transcription in the backend has finished.
         * @returns {void}
         */
        private handleTranscriptionUpdate(status: TranscriptionStatus) {
            if (status.transcription && status.transcription.trim() !== '') {
                this.statusManager.logMessage(`Transcription: "${status.transcription}"`);
            }
            
            if (this.processingQueue.length === 0) {
                this.statusManager.showSuccess("Transcription complete!");
                if (this.detectKeywords(status.transcription)) {
                    // this.statusManager.showInfo(`Command detected in: "${status.transcription}"`);
                    this.handleCommand(status.transcription);
                }
            } else {
                this.statusManager.showProcessing();
            }
        }

        /**
         * Processes the audio chunks in the processing queue. If not already processing, it marks the processing state, 
         * displays the "processing" status, and processes all chunks in parallel. After processing, the queue is cleared, and 
         * any errors during the process are handled. Once done, the processing flag is reset to allow for the next process.
         *
         * @returns {void}
         */
        private async processQueue() {
            if (this.isProcessing || this.processingQueue.length === 0) return;

            const queueStart = performance.now();
            // console.log(`Starting queue processing with ${this.processingQueue.length} items`);

            this.isProcessing = true;
            this.statusManager.showProcessing();

            try {
                // Process all chunks in parallel
                const promises = this.processingQueue.map(audioBlob => this.handleAudioChunk(audioBlob));
                this.processingQueue = []; // Clear queue to prevent duplicate processing
                await Promise.all(promises);
            } catch (error) {
                const errorMsg = "Error processing audio queue";
                this.statusManager.showError(errorMsg);
                console.error(errorMsg, error);
            } finally {
                this.isProcessing = false;
                console.log(`Queue processing complete in ${(performance.now() - queueStart).toFixed(2)}ms`);
            }
        }

        /**
         * Converts an AudioBuffer to a WAV format with 16-bit PCM encoding. This function takes a slice of the audio buffer 
         * based on the provided start time and converts the sliced buffer to a WAV Blob.
         * 
         * @param {AudioBuffer} audioBuffer - The original audio buffer to be converted.
         * @param {number} startTime - The start time (in seconds) of the audio slice to convert.
         * 
         * @returns {Promise<Blob | null>} A promise that resolves to a WAV Blob if conversion is successful, or null if no audio data to process or if an error occurs.
         */
        private async convertToWAV(audioBuffer: AudioBuffer, startTime: number): Promise<Blob | null> {
            const conversionStart = performance.now();
            // console.log("Starting WAV conversion");

            try {
                // Calculate start sample and length for the audio slice we want
                const startSample = Math.floor(startTime * audioBuffer.sampleRate);
                const samplesToProcess = audioBuffer.length - startSample;

                if (samplesToProcess <= 0) {
                    console.log("No audio data to process");
                    return null;
                }

                // console.log("Processing slice from " +  startSample + " to " + (startSample + samplesToProcess));

                const offlineContext = new OfflineAudioContext({
                    numberOfChannels: 1,
                    length: samplesToProcess,
                    sampleRate: 16000
                });

                // buffer for just audio slice we want
                const slicedBuffer = this.audioContext.createBuffer(
                    1,
                    samplesToProcess,
                    audioBuffer.sampleRate
                );

                // Copy just the new portion of audio
                const channelData = audioBuffer.getChannelData(0).slice(startSample);
                slicedBuffer.getChannelData(0).set(channelData);

                // Create a source node for the sliced buffer and start rendering it
                const source = offlineContext.createBufferSource();
                source.buffer = slicedBuffer;
                source.connect(offlineContext.destination);
                source.start();
                const renderedBuffer = await offlineContext.startRendering();

                // convert to 16-bit PCM
                const float32Array = renderedBuffer.getChannelData(0);
                const int16Array = new Int16Array(float32Array.length);

                for (let i = 0; i < float32Array.length; i++) {
                    // Clip the float32 values to the range of -1 to 1 and convert them to 16-bit PCM
                    const s = Math.max(-1, Math.min(1, float32Array[i]));
                    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                if (int16Array.length === 0) return null;

                console.log(`Total WAV conversion took: ${(performance.now() - conversionStart).toFixed(2)}ms`);

                return new Blob([int16Array], { type: "audio/wav" });
            } catch (error) {
                const errorMsg = "Error converting audio";
                this.statusManager.showError(errorMsg);
                console.error(errorMsg, error);
                return null;
            }
        }

        /**
         * Handles the processing of an audio chunk, including converting it to base64, chunking it if necessary,
         * and sending it to a backend for further processing and transcription.
         * 
         * @param {Blob} audioBlob - The audio chunk (Blob) that needs to be processed.
         * @returns {void}
         */
        private async handleAudioChunk(audioBlob: Blob) {
            const processingStart = performance.now();
            console.log(`Starting audio chunk processing at ${new Date().toISOString()}`);

            try {
                const buffer = await audioBlob.arrayBuffer();
                // console.log("Audio chunk size (bytes):", buffer.byteLength);

                // If using a WebSocket handler, send binary data directly
                if (this.audioWebHandler != null) {
                    // Stream audio buffer directly over WebSocket
                    if (buffer.byteLength > this.MAX_CHUNK_SIZE) {
                        console.warn("Chunk too large, splitting...");
                        for (let i = 0; i < buffer.byteLength; i += this.MAX_CHUNK_SIZE) {
                            const chunk = buffer.slice(i, i + this.MAX_CHUNK_SIZE);
                            this.audioWebHandler.sendBinaryData(chunk);
                        }
                    } else {
                        this.audioWebHandler.sendBinaryData(buffer);
                    }
                    this.audioWebHandler.sendBinaryData(buffer);
                } else {
                    // Fallback to the original implementation
                    const bytes = new Uint8Array(buffer);

                    // Convert to base64 in chunks to avoid stack overflow
                    const base64Start = performance.now();
                    const base64String = this.arrayBufferToBase64(bytes);
                    const paddedBase64String = base64String.padEnd(Math.ceil(base64String.length / 4) * 4, "=");
                    console.log(`Base64 conversion took: ${(performance.now() - base64Start).toFixed(2)}ms`);
                    const chunks: AudioChunk[] = [];

                    // Split into chunks, ensuring each chunk is valid Base64
                    const chunkingStart = performance.now();
                    for (let i = 0; i < paddedBase64String.length; i += this.CHUNK_SIZE) {
                        const chunkData = paddedBase64String.slice(i, i + this.CHUNK_SIZE);
                        const sequence = `${Date.now()}-${Math.floor(i / this.CHUNK_SIZE)}`;
                        const end = i + this.CHUNK_SIZE >= paddedBase64String.length;

                        // Log each chunk's metadata
                        // console.log(`Chunk ${sequence}:`);
                        // console.log("  - Data length:", chunkData.length);
                        // console.log("  - End flag:", end);

                        chunks.push({
                            sequence: sequence,
                            data: chunkData,
                            end: end,
                        });
                    }
                    console.log(`Chunk splitting took: ${(performance.now() - chunkingStart).toFixed(2)}ms`);
                    console.log(`Created ${chunks.length} chunks`);

                    // console.log("Number of chunks to send:", chunks.length);

                    // Send chunks to backend
                    const sendStart = performance.now();
                    for (let i = 0; i < chunks.length; i++) {
                        const chunk = chunks[i];
                        const chunkSendStart = performance.now();
                        await this.sendDataToHandler(JSON.stringify({
                            "class": "Transcriber",
                            "function": "addBase64Data",
                            "parameters": [JSON.stringify(chunk)]
                        }));
                        console.log(`Sent chunk ${i + 1}/${chunks.length} (${chunk.sequence}) - ${(performance.now() - chunkSendStart).toFixed(2)}ms`);
                    }
                    console.log(`Total chunk sending took: ${(performance.now() - sendStart).toFixed(2)}ms`);
                }

                console.log(`Total processing pipeline took: ${(performance.now() - processingStart).toFixed(2)}ms`);
            } catch (error) {
                const errorMsg = "Error processing audio chunk";
                this.statusManager.showError(errorMsg);
                console.error(errorMsg, error);
            }
        }

        /**
         * Safely converts a Uint8Array to a base64 string by processing the data in chunks.
         *
         * This method is necessary because standard base64 conversion using btoa(String.fromCharCode(...bytes))
         * can cause stack overflow errors on large arrays. By default, it is attempted to pass each byte as a
         * separate argument to String.fromCharCode, which can exceed TypeScripts's maximum call stack size
         * when dealing with large audio chunks.
         *
         * Resoulution:
         * 1. Processes the Uint8Array in smaller chunks (8KB each) to prevent stack overflow
         * 2. For each chunk:
         *    - Takes a slice of the original array
         *    - Uses String.fromCharCode.apply() to convert bytes to characters
         *    - This approach avoids spreading the entire array at once
         * 3. Concatenates all chunks into a single binary string
         * 4. Finally converts the complete binary string to base64 using btoa()
         *
         * @param {Uint8Array} bytes - The Uint8Array containing the binary data to convert
         * @returns {string} A base64 encoded string representation of the input data
         *
         * Example stack overflow scenario prevented:
         * - A 1MB audio chunk = 1,048,576 bytes
         * - Without chunking: String.fromCharCode(...1,048,576 arguments) -> Stack overflow
         * - With chunking: Process 8KB chunks = 128 iterations of String.fromCharCode(~8192 arguments)
         */
        private arrayBufferToBase64(bytes: Uint8Array): string {
            const CHUNK_SIZE = 8192; // process 8KB at a time to avoid stack overflow
            let binary = "";
            for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
                const chunk = bytes.slice(i, i + CHUNK_SIZE);
                binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
            }
            return btoa(binary);
        }

        /**
         * Determines if the given audio data (in bytes) represents silence by analyzing its energy level.
         * 
         * This method calculates the average energy of the audio data by converting the byte array 
         * (representing 16-bit PCM audio) into audio samples and then computing the average absolute 
         * value of the samples. If the energy is below a defined threshold, the function considers 
         * the audio as silence.
         * 
         * **How Silence Detection is Achieved:**
         * 1. The byte array (`Uint8Array`) represents audio data, where each 16-bit sample is stored
         *    as two consecutive bytes in little-endian format.
         * 2. The function extracts each 16-bit audio sample by combining two bytes.
         * 3. The absolute value of each sample is computed and summed up.
         * 4. The energy of the audio is calculated as the average absolute value of all samples.
         * 5. If the energy value is below a set threshold, the function classifies the audio as silence.
         * 
         * @param {Uint8Array} bytes - The audio data represented as a byte array in 16-bit PCM format.
         * @returns {boolean} - Returns `true` if the audio is considered silence (energy below threshold), 
         *                      `false` otherwise.
         */
        private isSilence(bytes: Uint8Array): boolean {
            const numBytesRead = bytes.length;

            // console.log("Bytes length:", numBytesRead);

            // Calculate the average energy of the audio data
            let sum = 0;
            for (let i = 0; i < numBytesRead - 1; i += 2) {
                // Combine two bytes into one sample (16-bit audio)
                const sample = (bytes[i + 1] << 8) | (bytes[i] & 0xFF);
                sum += Math.abs(sample);
            }

            const energy = sum / (numBytesRead / 2); // numBytesRead / 2 because each sample is 2 bytes (16 bits)
            // console.log("Audio energy:", energy);
            this.audioController.updateMeter(energy);
            return energy < this.audioController.getThreshold();
        }

        /**
         * Detects if any predefined command keywords are present in the transcription.
         * 
         * This function processes the transcription string by:
         * 1. Converting the transcription to lowercase.
         * 2. Removing any non-alphabetical characters (except spaces).
         * 3. Splitting the cleaned transcription into individual words.
         * 4. Checking if any of the predefined command keywords are present in the resulting list of words.
         * 
         * @param {string} transcription - The transcribed text to search for keywords in.
         * @returns {boolean} - Returns `true` if any of the predefined command keywords are found in the transcription, `false` otherwise.
         */
        private detectKeywords(transcription: string): boolean {
            const words = transcription.toLowerCase().replace(/[^a-zA-Z\s]/g, "").split(" ");
            return this.commandKeywords.some(keyword => words.includes(keyword.toLowerCase()));
        }

        /**
         * Handle transcription result and call the registered callback
         * 
         * @param {string} transcription The transcription result
         * @returns {void}
         */
        private async handleFunctionCall(fcCallRes: string) {
            this.statusManager.showSuccess("Query submitted!");
            this.statusManager.logMessage("LLM Response: " + fcCallRes);
            if (this.fcCallback) {
                this.fcCallback(fcCallRes); // Trigger the callback with the transcription result
            }
        }

        /**
         * Handles a transcription and triggers the appropriate function based on the identified command.
         * 
         * How it Works:
         * 1. Extracts the command from the transcription.
         * 2. Cleans up the transcription by removing the command.
         * 3. Sets up the query for the function resolver.
         * 4. Submit the query for function resolution.
         * 5. Wait for the result and evoke the callback function with the result.
         * 6. Clears the transcription buffer to avoid duplicate processing and decrease transmission data.
         * 
         * @param {string} transcription - The transcribed text containing a command.
         */
        private async handleCommand(transcription: string) {
            // Extract command
            const command = this.extractCommand(transcription);
            const msg = "Identified command: " + command + ". Making function call request...";
            this.statusManager.logMessage(msg);
            console.log(msg);

            await this.setUpResolver(); // Define tools for the LLM

            // Remove the extracted command from transcription
            const cleanedTranscription = transcription.toLowerCase().replace(command.toLowerCase(), "").trim();

            // Set query and resolve functions
            await this.sendDataToHandler(JSON.stringify({
                "class": "FunctionResolver",
                "function": "setQuery",
                "parameters": [cleanedTranscription]
            }));
            const functioncallresult = await this.submitQuery();
            // invoke the functioncall callback
            this.handleFunctionCall(functioncallresult);

            // Clear transcription buffer
            await this.sendDataToHandler(JSON.stringify({
                "class": "Transcriber",
                "function": "clearAll",
                "parameters": []
            }));
        }

        /**
         * Registers a callback to be called when transcription is done
         * 
         * @param {function} callback The function to be called with the transcription result
         * @returns {void}
         */
        public onFCComplete(callback: (transcription: string) => void) {
            this.fcCallback = callback;
        }

        /**
         * Extracts the command from the transcription by searching for predefined keywords.
         * 
         * @param {string} transcription - The transcribed text to extract the command from.
         * @returns {string} - The matched command keyword or an empty string if no match is found.
         */
        private extractCommand(transcription: string): string {
            const lowerTranscription = transcription.toLowerCase().trim();
        
            for (const keyword of this.commandKeywords) {
                const lowerKeyword = keyword.toLowerCase().trim();
                if (lowerTranscription.includes(lowerKeyword)) {
                    return lowerKeyword;
                }
            }
            return "";
        }

        /**
         * Stops the continuous audio recording and clears any scheduled audio chunk intervals.
         * 
         * @returns {Promise<void>}
         */
        public async stopContinuousRecording() {
            if (this.chunkIntervalId !== null) {
                window.clearInterval(this.chunkIntervalId);
                this.chunkIntervalId = null;
            }

            if (this.mediaRecorder) {
                this.mediaRecorder.stop();
            }
        }

        /**
         * Toggles audio capture state and processes captured audio
         * 
         * @returns {Promise<void>}
         */
        public async toggleCapture() {
            const msg = "Audio Capture: " + (this.capturing ? "OFF" : "ON");
            console.log(msg);
            this.statusManager.logMessage(msg);

            if (this.capturing) {
                this.capturing = false;
                await this.stopContinuousRecording();
            } else {
                this.capturing = true;
                await this.startContinuousRecording();
            }
        }

        /**
         * Starts recording audio using the MediaRecorder API (https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API). Configures the recorder with
         * audio settings, stores audio chunks, and prepares an audio context for processing.
         * 
         * @returns {Promise<void>}
         */
        public async startRecording() {
            // Set the audio format to match backend (16kHz, mono, 16-bit)
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    sampleSize: 16,
                    noiseSuppression: false,
                    echoCancellation: false,
                    autoGainControl: false
                }
            });

            if (!MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
                const errorMsg = "audio/webm;codecs=opus format not supported in this browser.";
                this.statusManager.showError(errorMsg);
                console.error(errorMsg);
                return;
            }

            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: "audio/webm;codecs=opus"
            });
            this.audioChunks = [];  // Initialize empty array to store audio chunks
            this.audioContext = new AudioContext({ sampleRate: 16000 });  // Audio context (https://developer.mozilla.org/en-US/docs/Web/API/AudioContext) with 16 kHz sample rate

            // When new data is available from the recorder push it to the audioChunks array
            this.mediaRecorder.ondataavailable = (event) => {
                // console.log("Received audio data chunk of size:", event.data.size);
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            // Start recording
            this.mediaRecorder.start(this.chunkInterval / 2);

            const msg = "MediaRecorder started with interval:" + this.chunkInterval / 2;
            console.log(msg);
            this.statusManager.logMessage(msg);
        }

        /**
         * Retrieves a specific element (to modify/read) by type and label
         * 
         * @param {string} type Element type
         * @param {string} label Element label
         * @returns {HTMLElement | undefined} HTMLElement or undefined if not found
         */
        public getElement(type: string, label: string): HTMLElement | undefined {
            return this.elementMap.get(type)?.get(label);
        }

        /**
         * Gets all element labels of a specific type
         * @param {string} type Element type
         * @returns {string[]} Array of element labels
         */
        public getAllElements(type: string): string[] {
            const elements = this.elementMap.get(type);
            return elements ? Array.from(elements.keys()) : [];
        }

        /**
         * Adds a tool schema generator (not its result) to the registry
         * 
         * @param {function} schemaGenerator Function that generates schema
         */
        public addToolSchema(schemaGenerator: () => any): void {
            // The reason we store the function is that we want to evaluate it later on demand (this is done to ensure everything has already been correclty initialized)
            if (typeof schemaGenerator !== "function") {
                console.error("Schema generator must be a function");
                return;
            }
            this.toolSchemas.push(schemaGenerator);
            // console.log(this.toolSchemas);
        }

        /**
         * Invokes each schemaGenerator function to generate the actual schema and return them as JSON strings
         * 
         * @returns {Promise<string>} Array of JSON schema strings
         */
        public async getToolSchemas(): Promise<string[]> {
            const schemaPromises = this.toolSchemas.map(async generator => {
              try {
                // generator() calls the schema generator function which will return a schema object
                const schema = await generator();
                // Ensure the schema is properly formatted
                if (typeof schema !== "object") {
                  throw new Error("Schema generator must return an object");
                }
                // JSON.stringify(generator()) converts that object into a JSON string
                return JSON.stringify(schema);
              } catch (error) {
                console.error("Error generating schema:", error);
                return null;
              }
            });

            // Wait for all schemas to be generated
            const schemas = await Promise.all(schemaPromises);
            return schemas.filter(schema => schema !== null);
        }

        /**
         * Resets the entire tool’s state including the states of its backend instances, clearing buffers, stopping any active capture, and resetting relevant data.
         * 
         * @returns {void}
         */
        public reset(): void {
            if (this.capturing){
                this.audioController.toggleCapture();
            }

            this.processingQueue = [];
            this.audioChunks = [];
            this.lastTranscription = "";

            this.sendDataToHandler(JSON.stringify({
                "class": "Transcriber",
                "function": "clearAll",
                "parameters": []
            }));

            this.sendDataToHandler(JSON.stringify({
                "class": "FunctionResolver",
                "function": "clearAll",
                "parameters": []
            }));

            this.statusManager.showInfo("Reset tool state")
        }
    }
