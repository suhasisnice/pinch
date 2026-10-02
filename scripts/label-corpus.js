const fs = require('fs');
const path = require('path');
// Real messages: this talks to the local Ollama only, never a gateway or a cloud model.

const privateDir = path.join(__dirname, '../private');
const rawPath = path.join(privateDir, 'raw.jsonl');
const labelsPath = path.join(privateDir, 'labels.jsonl');

const model = process.env.PINCH_LABEL_MODEL || 'qwen2.5-coder:7b';

async function labelCorpus() {
  if (!fs.existsSync(rawPath)) {
    console.log('raw.jsonl not found');
    return;
  }

  const rawLines = fs.readFileSync(rawPath, 'utf8').split('\n').filter(Boolean);
  const existingLabels = new Set();

  if (fs.existsSync(labelsPath)) {
    const labelsLines = fs.readFileSync(labelsPath, 'utf8').split('\n').filter(Boolean);
    labelsLines.forEach(line => {
      const data = JSON.parse(line);
      existingLabels.add(data.id);
    });
  }

  const labelsStream = fs.createWriteStream(labelsPath, { flags: 'a' });
  let count = 0;

  for (const rawLine of rawLines) {
    const raw = JSON.parse(rawLine);

    if (existingLabels.has(raw.id)) {
      continue;
    }

    const prompt = `Analyze this SMS message and provide the following information in JSON format: {"isTransaction": boolean, "amount": number|null, "direction": 'DEBIT'|'CREDIT'|null, "name": string|null}.\n\nSource: ${raw.source}\nSender: ${raw.sender}\nBody: ${raw.body}\n\nRules:\n- isTransaction is true only if money actually moved in or out of the phone owner's own account (not an offer, OTP, balance enquiry, payment request, reminder, or failed payment).\n- direction is CREDIT if the owner received money, DEBIT if the owner paid.\n- name is the other party (person or merchant), null if not stated.\n- amount is the amount that moved, not the remaining balance.`;

    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: 0,
          },
        }),
      });

      const data = await response.json();
      const answer = JSON.parse(data.response);

      labelsStream.write(JSON.stringify({
        id: raw.id,
        isTransaction: answer.isTransaction,
        amount: answer.amount,
        direction: answer.direction,
        name: answer.name,
      }) + '\n');

      count++;
      process.stdout.write(`labelled ${count}`);
    } catch (error) {
      console.error(`skipped ${raw.id}: ${error.message}`);
    }
  }

  labelsStream.end();
}

labelCorpus();
