import OpenAI from "openai";
import {
  CopilotKitResponse,
  CopilotKitServiceAdapter,
  OnFinalChatCompletionCallback,
} from "../types/service-adapter";
import { limitOpenAIMessagesToTokenCount, maxTokensForOpenAIModel } from "../utils/openai";
import { ChatCompletion } from "openai/resources";
import { ChatCompletionStream } from "openai/lib/ChatCompletionStream";

const DEFAULT_MODEL = "gpt-4-1106-preview";

export interface OpenAIAdapterParams {
  openai?: OpenAI;
  model?: string;
}

export class OpenAIAdapter implements CopilotKitServiceAdapter {
  private model: string = DEFAULT_MODEL;

  private _openai: OpenAI;
  public get openai(): OpenAI {
    return this._openai;
  }

  constructor(params?: OpenAIAdapterParams) {
    this._openai = params?.openai || new OpenAI({});
    if (params?.model) {
      this.model = params.model;
    }
  }

  async getResponse(
    forwardedProps: any,
    options: {
      onFinalChatCompletion?: OnFinalChatCompletionCallback<ChatCompletion>;
    } = {},
  ): Promise<CopilotKitResponse> {
    // copy forwardedProps to avoid modifying the original object
    forwardedProps = { ...forwardedProps };

    // Remove tools if there are none to avoid OpenAI API errors
    // when sending an empty array of tools
    if (forwardedProps.tools && forwardedProps.tools.length === 0) {
      delete forwardedProps.tools;
    }

    const messages = limitOpenAIMessagesToTokenCount(
      forwardedProps.messages || [],
      forwardedProps.tools || [],
      maxTokensForOpenAIModel(forwardedProps.model || this.model),
    );

    return new Promise((resolve, reject) => {
      // remove message.function_call.scope if it's present.
      // scope is a field we inject as a temporary workaround (see elsewhere), which openai doesn't understand
      messages.forEach((message) => {
        if (message.function_call?.scope) {
          delete message.function_call.scope;
        }
      });

      let stream: ChatCompletionStream;

      try {
        stream = this.openai.beta.chat.completions.stream({
          model: this.model,
          ...forwardedProps,
          stream: true,
          messages: messages as any,
        });
      } catch (error) {
        return reject(error);
      }

      stream.on("error", (error) => {
        reject(error); // Reject the promise with the error
      });

      stream.on("connect", () => {
        resolve({ stream: stream.toReadableStream() });
      });

      if (options.onFinalChatCompletion) {
        stream
          .finalChatCompletion()
          .then(options.onFinalChatCompletion)
          .catch((error) => {
            reject(error);
          });
      }
    });
  }
}
