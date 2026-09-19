/** Older MCP clients may cache schemas. Missing IDs must still retry safely. */
export async function loungeRequestId(owner: string, input: {
  sofa_id: string; sender: string; content: string; request_id?: string;
  mentions?: string[]; reply_to_id?: string;
}): Promise<string> {
  const supplied = input.request_id?.trim();
  if (supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied)) return supplied.toLowerCase();
  const identity = supplied
    ? ['lounge-request-v1', owner, input.sofa_id, input.sender, supplied]
    : ['lounge-content-v1', owner, input.sofa_id, input.sender, input.content,
      input.reply_to_id ?? null, [...new Set(input.mentions ?? [])].sort()];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
