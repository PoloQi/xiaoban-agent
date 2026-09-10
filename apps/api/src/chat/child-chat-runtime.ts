import type { Kysely, Transaction } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import { DeepSeekGateway, type FetchTransport } from "../ai/deepseek-gateway.js";
import { InternalAiOrchestrator } from "../ai/internal-orchestrator.js";
import { loadDeepSeekConfig } from "../ai/model-config.js";
import { ReviewedContentRetrievalService } from "../ai/reviewed-content-retrieval.js";
import { GenerationControlStore } from "../safety/generation-control-store.js";
import { ChildChatService } from "./child-chat-service.js";

type ConfigSource = Readonly<Record<string, string | undefined>>;

interface ChildChatRuntimeOptions {
  configSource: ConfigSource;
  database: Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;
  transport?: FetchTransport;
}

export function createChildChatService(
  options: ChildChatRuntimeOptions,
): ChildChatService {
  let gateway: DeepSeekGateway;
  try {
    const config = loadDeepSeekConfig(options.configSource);
    gateway = new DeepSeekGateway(config, options.transport);
  } catch {
    return new ChildChatService(options.database);
  }

  const generationControl = new GenerationControlStore(options.database);
  const retrieval = new ReviewedContentRetrievalService(options.database);
  const orchestrator = new InternalAiOrchestrator({
    gate: () => generationControl.evaluateGate(),
    retrieve: (input) => retrieval.retrieve(input),
    generate: (input) => gateway.generate(input),
  });

  return new ChildChatService(options.database, (input) => orchestrator.run(input));
}
