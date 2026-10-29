# Last Witness

An interactive short story about an abandoned amusement park, a failing computer, and the things a person chooses to remember.

[Play the public demo](https://lastwitness-erlik.vercel.app)

The public demo is the archive edition: keyword routing, no model inference, and browser-local progress. The local edition below uses Ollama with an open-weight model.

Fourteen story fragments. Seven questions. Each answer preserves one record in your notebook while a different record disappears from the witness. At the end, you write the only account that will survive. Bellwether Park and its characters are fictional.

## Run

Requires Node.js 20 or newer. There are no package dependencies and no installation step.

```sh
npm start
```

Open http://127.0.0.1:4177. The server binds to the local computer only. Set `PORT` to change the port.

## Local AI edition

Install Ollama and download an open-weight instruction model compatible with structured outputs. For example:

```sh
ollama pull qwen2.5:3b
```

Start Ollama, start this game, then choose an installed model on the connection screen. The model reads your question and the records that remain in the witness. It selects a relevant record using a constrained JSON response. The model selects from prewritten story passages rather than generating dialogue. Model quality and response speed depend on the selected model and computer.

The server calls `http://127.0.0.1:11434` by default. `OLLAMA_HOST` can point to a different Ollama endpoint. Keep the default to keep inference on your own computer. No credentials are needed. The browser never calls Ollama directly.

Every question is a fresh model request. No previous dialogue, rescued records, or erased records are sent. The server validates the chosen record before committing the transition. A failed model request leaves the recording untouched. The model cannot rewrite the story or resurrect an erased record.

## Authored archive edition

The complete story is playable without a model. This edition uses simple keyword routing and is explicitly labeled as having no AI inference. Map signals offer useful questions. This is a fallback for playing the story, not proof of the open-weight AI integration.

## Saving and privacy

Active recordings live in server memory; a browser-local session identifier reconnects on refresh. Restarting the server expires unfinished sessions. Final records and writing drafts are stored in this browser. A final record remains available after restarting the server and can be downloaded as plain text. Beginning again replaces the browser's current record. No analytics, remote assets, accounts, API keys, or external fonts are used.

## Verify and package

```sh
npm test
npm run test:model
npm run build
node dist/server.js
```

The model check requires a running Ollama instance with `qwen2.5:3b` installed, or the `MODEL` environment variable set to another compatible installed model. It verifies direct questions, paraphrases, unrelated questions, and a removed record against real inference. The main test suite uses a local mock model server to test inference errors and concurrent requests without requiring model weights.

The build copies the application into `dist/`. This game requires its Node server for model routing and authoritative state; it is not a static-only site. Port 4177 must be free before starting another copy.

## Public demo build

```sh
npm run build:public
```

This produces the browser-only archive edition in `dist/`. Serve that directory with a static web host. Run `npm run build` to produce the local Node edition again. The public build reuses the same engine and story, with browser storage replacing the local server.

## Design

The interface uses paper, admission tickets, a technical site plan, a transcript, and a notebook. All illustrations are CSS and SVG. Ambient hum and transmission tones are synthesized locally with Web Audio after an explicit sound toggle. The game works without sound and honors reduced-motion preferences. The interface and story are in English.

## Challenge notes

Built for the Hacktoberfest Open-Source AI Challenge: Week 4, Ghost in the Machine. The local edition uses an open-weight model to interpret questions and select memories.

## License

MIT. See LICENSE. Model weights retain their own upstream licenses.
