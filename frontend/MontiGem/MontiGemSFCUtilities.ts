/**
 * @fileoverview A comprehensive utility file for MontiGem users to integrate the SFC seamlessly, providing element registries, schemas, functions, and command handling.
 * @author Louis Wellmeyer
 * @date March 31, 2025
 */

import { ElementHandler, ElementRegistry, SpeechFunctionCaller, CommunicationHandler } from '../../../SpeechFunctionCaller/frontend/src/SpeechFunctionCaller';
import { Caller } from 'demorec/commands/Caller';
import { CommandManager } from '@umlp/common';

// =================================================================
// MontiGem Communication Handler
// =================================================================

export class MontiGemCommunicationHandler implements CommunicationHandler {
    private clientID: string;

    constructor(clientID: string) {
        this.clientID = clientID;
    }

    async sendData(data: string): Promise<any> {
        try {
            // This assumes your application has a Caller command defined
            const result = await CommandManager.executeCommand(new Caller(this.clientID, data));
            const response = result.asSimpleResult().get();
            return response;
        } catch (error) {
            console.error("Error sending data:", error);
            throw error;
        }
    }
}

// =================================================================
// Element Handlers for MontiGem Components
// =================================================================

export class GemTextInputHandler implements ElementHandler {
    getLabel(root: HTMLElement): string {
        const label = root.querySelector('label');
        return label ? label.textContent?.trim() : "";
    }

    getElement(root: HTMLElement): HTMLElement | null {
        return root.querySelector('input') || null;
    }
}

export class GemButtonHandler implements ElementHandler {
    getLabel(root: HTMLElement): string {
        const label = root.querySelector('button');
        return label ? label.textContent?.trim() : "";
    }

    getElement(root: HTMLElement): HTMLElement | null {
        return root.querySelector('button') || null;
    }
}

export class GemDropdownHandler implements ElementHandler {
    getLabel(root: HTMLElement): string {
        const label = root.querySelector('.gem-label-text-input');
        return label ? label.textContent?.trim() : "";
    }

    getElement(root: HTMLElement): HTMLElement | null {
        return root.querySelector('.gem-dropdown-input') || null;
    }
}

export class GemLinkHandler implements ElementHandler {
    getLabel(root: HTMLElement): string {
        const label = root.querySelector('a');
        return label ? label.textContent?.trim() : "";
    }

    getElement(root: HTMLElement): HTMLElement | null {
        return root.querySelector('a') || null;
    }
}

// =================================================================
// Function to register all element handlers at once
// =================================================================

export function registerMontiGemElements(): void {
    ElementRegistry.registerHandler('gem-text-input', new GemTextInputHandler());
    ElementRegistry.registerHandler('gem-button', new GemButtonHandler());
    ElementRegistry.registerHandler('gem-dropdown-input', new GemDropdownHandler());
    ElementRegistry.registerHandler('gem-link', new GemLinkHandler());
}

// =================================================================
// Pre-defined Function Call Schemas
// =================================================================

export function getTextFieldSchema() {
    return function () {
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
                        description: "The text to enter inside the specified textfield. Format all dates as 'YYYY-MM-DD' for date fields and 'YYYY-MM-DDTHH:mm' for datetime-local fields."
                    }
                },
                required: ["textField", "value"],
                additional_properties: false
            },
            strict: true
        };
    };
}

export function getButtonSchema() {
    return function () {
        return {
            name: "envokeButtonFunction",
            description: "IMPORTANT: This function must ONLY be called when the user's input is an EXACT match from the button list.",
            parameters: {
                type: "object",
                properties: {
                    button: {
                        type: "string",
                        enum: SpeechFunctionCaller.getInstance().getAllElements("gem-button"),
                        description: "The label of the button to be clicked. This must match exactly one of the values in the button list."
                    }
                },
                required: ["button"],
                additional_properties: false
            },
            strict: true
        };
    };
}

export function getLinkSchema() {
    return function () {
        return {
            name: "pressLink",
            description: "IMPORTANT: This function must ONLY be called when the user's input is an EXACT match from the link list.",
            parameters: {
                type: "object",
                properties: {
                    link: {
                        type: "string",
                        enum: SpeechFunctionCaller.getInstance().getAllElements("gem-link"),
                        description: "The label of the link to be clicked. This must match exactly one of the values in the link list."
                    }
                },
                required: ["link"],
                additional_properties: false
            },
            strict: true
        };
    };
}

export function getDropdownSchema() {
    return async function () {
        const dropdowns = SpeechFunctionCaller.getInstance().getAllElements("gem-dropdown-input");
        const allOptions: string[] = [];

        // Helper function to get dropdown options
        const getDropdownOptions = async (dropdownLabel: string): Promise<string[]> => {
            const element = SpeechFunctionCaller.getInstance().getElement("gem-dropdown-input", dropdownLabel);
            const options: string[] = [];

            if (!element) return options;

            // Click to open dropdown
            element.click();

            // Wait for dropdown content
            const dropdownContent = await (async (): Promise<HTMLElement | null> => {
                for (let i = 0; i < 20; i++) {
                    const content = element.parentElement.querySelector('.gem-dropdown-content');
                    if (content) {
                        return content as HTMLElement;
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                return null;
            })();

            if (dropdownContent) {
                const optionElements = dropdownContent.querySelectorAll('.gem-dropdown-option');

                for (const option of Array.from(optionElements)) {
                    const text = option.textContent?.trim();
                    if (text) {
                        const prefixedOption = `${dropdownLabel}#${text}`;
                        options.push(prefixedOption);
                    }
                }
            }

            // Close dropdown
            element.click();
            return options;
        };

        // Process all dropdowns sequentially
        for (const dropdownLabel of dropdowns) {
            const options = await getDropdownOptions(dropdownLabel);
            allOptions.push(...options);
        }

        return {
            name: "setDropdownValue",
            description: "Sets a dropdown value. Values are in the format 'dropdownName#value'. Match user input to the closest fitting option from the enum list.",
            parameters: {
                type: "object",
                properties: {
                    dropdown: {
                        type: "string",
                        enum: dropdowns,
                        description: "The name of the dropdown field to set (matches the prefix before the colon in the value parameter)"
                    },
                    value: {
                        type: "string",
                        enum: [...allOptions],
                        description: "The full string in format 'dropdownName#value'"
                    }
                },
                required: ["dropdown", "value"],
                additional_properties: false
            },
            strict: true
        };
    };
}

// =================================================================
// Standard Function Implementations
// =================================================================

export class MontiGemSFCFunctions {
    // Text field implementation
    public static setTextField(textField: string, value: string): void {
        const inputElement = SpeechFunctionCaller.getInstance().getElement("gem-text-input", textField);
    
        if (inputElement instanceof HTMLInputElement) {
            let formattedValue = value;
    
            switch (inputElement.type) {
                case "date":
                    // Convert value to 'YYYY-MM-DD' format
                    formattedValue = new Date(value).toISOString().split('T')[0];
                    break;
                case "datetime-local":
                    // Convert to 'YYYY-MM-DDTHH:MM' format
                    formattedValue = new Date(value).toISOString().slice(0, 16);
                    break;
                case "number":
                    // Ensure value is a valid number
                    formattedValue = !isNaN(Number(value)) ? value : "0";
                    break;
            }
    
            // Set the formatted value
            inputElement.value = formattedValue;
            
            // Trigger input event to ensure Angular detects the change
            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            console.error("Input element of label: '" + textField + "' not found or is not an input element.");
        }
    }

    // Button click implementation
    public static invokeButtonFunction(button: string): void {
        const buttonElement = SpeechFunctionCaller.getInstance().getElement("gem-button", button);

        if (buttonElement instanceof HTMLButtonElement) {
            buttonElement.click();
            console.log(`Button with label '${button}' was clicked.`);
        } else {
            console.error(`Button with label '${button}' not found or is not a button element.`);
        }
    }

    // Link click implementation
    public static pressLink(link: string): void {
        const linkElement = SpeechFunctionCaller.getInstance().getElement("gem-link", link);

        if (linkElement instanceof HTMLAnchorElement) {
            linkElement.click();
            console.log(`Link with text '${link}' was clicked.`);
        } else {
            console.error(`Link with text '${link}' not found or is not an anchor element.`);
        }
    }

    // Dropdown value selection implementation
    public static setDropdownValue(dropdown: string, value: string): void {
        const element = SpeechFunctionCaller.getInstance().getElement("gem-dropdown-input", dropdown);
        if (element) {
            MontiGemSFCFunctions.selectDropDownOption(element, value.split("#")[1]);
        } else {
            console.error(`Dropdown with label '${dropdown}' not found.`);
        }
    }

    // Helper method for dropdown selection
    public static selectDropDownOption(elem: HTMLElement, optionText: string): void {
        if (elem) {
            // Open dropdown
            elem.click();

            // Function to check for dropdown content
            const findDropdownContent = async (): Promise<HTMLElement | null> => {
                for (let i = 0; i < 20; i++) { // Try for max 2 second (20 * 100ms)
                    const content = document.querySelector('.gem-dropdown-content');
                    if (content) {
                        return content as HTMLElement;
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                return null;
            };

            // Handle the dropdown content once it appears
            findDropdownContent().then(dropdownContent => {
                if (dropdownContent) {
                    const options = dropdownContent.querySelectorAll('.gem-dropdown-option');
                    for (const option of Array.from(options)) {
                        if (option.textContent?.trim() === optionText) {
                            (option as HTMLElement).click();
                            return;
                        }
                    }
                }

                // If we didn't find the content or the option, close the dropdown
                console.log('Option or dropdown content not found');
                elem.click();
            });
        }
    }
}

// =================================================================
// Function Call Result Handler
// =================================================================

export function handleFunctionCall(functionCallResult: string, context: any): void {
    const result = JSON.parse(functionCallResult);
    console.log("Function resolve result:", result);

    if (result.type === 'functions') {
        for (const func of result.functions) {
            if (func.name && func.args) {
                // Try to find function in the context object
                const functionRef = context[func.name];

                if (typeof functionRef === 'function') {
                    // Function exists in context, call it with the arguments
                    const argValues = Object.values(func.args);
                    console.log(`Calling function '${func.name}' with args:`, argValues);
                    functionRef.apply(context, argValues);
                } else {
                    // Function not found in context, try to find it in MontiGemSpeechFunctions
                    const staticFunctionRef = MontiGemSFCFunctions[func.name];
                    
                    if (typeof staticFunctionRef === 'function') {
                        const argValues = Object.values(func.args);
                        console.log(`Calling static function '${func.name}' with args:`, argValues);
                        staticFunctionRef.apply(null, argValues);
                    } else {
                        console.error(`Function '${func.name}' does not exist in context or static functions.`);
                    }
                }
            }
        }
    } else if (result.type === 'message') {
        console.log(result.content);
    } else if (result.status === 'error') {
        console.warn(result.message);
    }
}

// =================================================================
// Configuration Helper
// =================================================================

export function configureSpeechFunctionCaller(options: {
    endpoint: string,
    token: string,
    transcriberModel?: string,
    resolverModel?: string,
    audioWebHandler?: string,
    clientId?: string
    context?: any
}): void {
    // Register communication handler
    SpeechFunctionCaller.getInstance().setCommunicationHandler(new MontiGemCommunicationHandler(options.clientId || ""));
    
    // Set audio web handler if provided
    if (options.audioWebHandler) {
        SpeechFunctionCaller.getInstance().setAudioWebHandler(options.audioWebHandler, options.clientId);
    }
    
    // Set LLM credentials
    SpeechFunctionCaller.getInstance().setCredentials(
        options.endpoint,
        options.token,
        options.transcriberModel || 'whisper',
        options.resolverModel || 'gpt-4o'
    );
    
    // Register function call completion callback
    SpeechFunctionCaller.getInstance().onFCComplete((result) => {
        handleFunctionCall(result, options.context || null);
    });

    // Register element handlers
    registerMontiGemElements();
}