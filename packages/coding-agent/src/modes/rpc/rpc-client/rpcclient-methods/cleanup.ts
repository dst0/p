import { serializeJsonLine } from "../../jsonl.ts";
import type { RpcCommand, RpcResponse } from "../../rpc-types.ts";
import type { RpcClient } from "../rpcclient.ts";
import type { RpcCommandBody } from "../types.ts";

export async function do_send(self: RpcClient, command: RpcCommandBody): Promise<RpcResponse> {
  const childProcess = self.process;
  const stdin = childProcess?.stdin;
  if (!childProcess || !stdin) {
    throw new Error("Client not started");
  }
  if (self.exitError) {
    throw self.exitError;
  }
  if (childProcess.exitCode !== null) {
    const error = self.createProcessExitError(childProcess.exitCode, childProcess.signalCode);
    self.exitError = error;
    throw error;
  }
  if (stdin.destroyed || !stdin.writable) {
    const error = new Error(`Agent process stdin is not writable. Stderr: ${self.stderr}`);
    self.exitError = error;
    throw error;
  }

  const id = `req_${++self.requestId}`;
  const fullCommand = { ...command, id } as RpcCommand;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      self.pendingRequests.delete(id);
      reject(new Error(`Timeout waiting for response to ${command.type}. Stderr: ${self.stderr}`));
    }, 30000);

    self.pendingRequests.set(id, {
      resolve: (response) => {
        clearTimeout(timeout);
        resolve(response);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });

    try {
      stdin.write(serializeJsonLine(fullCommand));
    } catch (error: unknown) {
      const writeError = error instanceof Error ? error : new Error(String(error));
      const pending = self.pendingRequests.get(id);
      self.pendingRequests.delete(id);
      pending?.reject(writeError);
    }
  });
}

export function do_getData<T>(_self: RpcClient, response: RpcResponse): T {
  if (!response.success) {
    const errorResponse = response as Extract<RpcResponse, { success: false }>;
    throw new Error(errorResponse.error);
  }
  // Type assertion: we trust response.data matches T based on the command sent.
  // This is safe because each public method specifies the correct T for its command.
  const successResponse = response as Extract<RpcResponse, { success: true; data: unknown }>;
  return successResponse.data as T;
}
