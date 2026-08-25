# JSON-in-Content Fallback Format (Phase 4 Reference)

Some Ollama models (e.g. `mistral:7b`, `codellama:7b`) do not emit native
`tool_calls` fields. Instead they embed tool-call JSON inside the `content`
string, often inside a fenced code block.

## Detection heuristic

If the response has no `tool_calls` (or an empty array) AND `content` contains
a JSON object or array with a `"tool"` key, attempt to parse.

## Formats the shim must handle

### Single call, bare JSON

```json
{"tool": "lb_read_file", "parameters": {"path": "README.md"}}
```

### Multiple calls, JSON array

```json
[
  {"tool": "lb_read_file",   "parameters": {"path": "README.md"}},
  {"tool": "lb_list_folder", "parameters": {"path": "."}}
]
```

### Prose prefix with fenced JSON block

```
I'll read the file now.

```json
{"tool": "lb_read_file", "parameters": {"path": "README.md"}}
```
```

## Normalisation map

| JSON-in-content key | Maps to tool_calls field      |
|---------------------|-------------------------------|
| `tool`              | `function.name`               |
| `parameters`        | `function.arguments` (string) |
| `id` (optional)     | `id` (generated if absent)    |

## Normalised output shape

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_1715000000000",
      "type": "function",
      "function": {
        "name": "lb_read_file",
        "arguments": "{\"path\":\"README.md\"}"
      }
    }
  ]
}
```

The shim never mutates the stored turn array — it outputs a normalised copy
used only for tool-runner invocation and appending the `tool_result` turn.
