import { normalizeProviderUsage, aggregateProviderUsage, priceProviderUsage } from "../packages/shared/dist/index.js";
export { priceProviderUsage };
const eventsFor = stdout => stdout.split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
export function parseAgentStream(stdout) {
  const events = eventsFor(stdout), terminal = events.filter(x => x.event === "result").at(-1)?.result;
  const raw = terminal?.usage ?? events.filter(x => x.step_update?.usage).at(-1)?.step_update?.usage;
  const usage = raw ? normalizeProviderUsage(raw, { accumulation: "accumulated", inputIncludesCached: null, outputIncludesThinking: null }) : null;
  return { eventCount:events.length,toolCallCount:events.filter(x=>x.step_update?.step_type==="tool").length,status:terminal?.status??"partial",error:terminal?.error??null,conversationId:terminal?.conversation_id,usage };
}
export function parseOpenCodeStream(stdout) {
  const events = eventsFor(stdout), finishes = events.filter(x=>x.type==="step_finish"&&x.part), errors = events.filter(x=>x.type==="error"||x.error).map(x=>x.error?.data?.message??x.error?.message??x.message??String(x.error));
  const samples = finishes.filter(x=>x.part.tokens).map(x => {
    const tokens=x.part.tokens;
    return normalizeProviderUsage({inputTokens:tokens.input,outputTokens:tokens.output,thinkingTokens:tokens.reasoning,cacheReadTokens:tokens.cache?.read,cacheCreationTokens:tokens.cache?.write,totalTokens:tokens.total}, {accumulation:"per_step",inputIncludesCached:false,outputIncludesThinking:null});
  });
  return {eventCount:events.length,toolCallCount:events.filter(x=>x.type==="tool_use"||x.part?.type==="tool").length,status:errors.length?"ERROR":finishes.length?"completed":"partial",error:errors.at(-1)??null,conversationId:events.find(x=>x.sessionID)?.sessionID,usage:aggregateProviderUsage(samples),reportedCost:finishes.every(x=>typeof x.part.cost==="number")&&finishes.length?finishes.reduce((sum,x)=>sum+x.part.cost,0):null};
}
