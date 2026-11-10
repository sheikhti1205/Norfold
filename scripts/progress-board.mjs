import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, '.beads/issues.jsonl');
const board = resolve(root, 'docs/progress/board.html');
const start = '<!-- BOARD_DATA_START -->';
const end = '<!-- BOARD_DATA_END -->';

try {
  let input;
  try {
    input = await readFile(source, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read Beads export ${source}: ${error.message}`);
  }
  if (!input.trim()) throw new Error(`Beads export is empty: ${source}`);
  const issues = input.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try {
      const issue = JSON.parse(line);
      if (!issue || issue._type !== 'issue' || !issue.id || !issue.status) throw new Error('expected an issue with id and status');
      return issue;
    } catch (error) {
      throw new Error(`Invalid Beads export line ${index + 1}: ${error.message}`);
    }
  });
  const html = await readFile(board, 'utf8');
  if (html.split(start).length !== 2 || html.split(end).length !== 2 || html.indexOf(start) > html.indexOf(end)) {
    throw new Error('Board data sentinels are missing, duplicated, or out of order');
  }
  const data = JSON.stringify(issues).replace(/</g, '\\u003c');
  const replacement = `${start}\n<script type="application/json" id="board-data">${data}</script>\n${end}`;
  const updated = html.slice(0, html.indexOf(start)) + replacement + html.slice(html.indexOf(end) + end.length);
  if (updated !== html) await writeFile(board, updated, 'utf8');
  console.log(`Progress board: ${issues.length} issues (${updated === html ? 'unchanged' : 'updated'}).`);
} catch (error) {
  console.error(`Progress board: ${error.message}`);
  process.exitCode = 1;
}
