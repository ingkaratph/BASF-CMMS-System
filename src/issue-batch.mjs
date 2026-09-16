export async function issueSequentially(lines, send, result) {
  let saved = 0;
  for (const line of lines.filter(line => line.state === 'pending')) {
    try { await send(line); }
    catch (error) { result(line, 'uncertain', error); break; }
    saved++;
    result(line, 'saved');
  }
  return saved;
}
