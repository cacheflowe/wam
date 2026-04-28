# Audio Routing Protocol

Status: Active | Owner: Justin Gitlin | Last reviewed: 2026-04-27

## Context

The Web Audio API's `AudioNode.connect()` accepts only `AudioNode` arguments. Library objects (instruments, effects) need to connect to each other and to raw nodes interchangeably, without wrapping everything in `AudioNode` subclasses.

## Decision

Every library class exposes two members:

```js
connect(node) {
  this._out.connect(node.input ?? node);
  return this;
}

get input() {
  return this._in;  // or this._out, if the class has no input stage
}
```

The `node.input ?? node` expression resolves:
- Library object → uses `node.input` (a `GainNode` or `AudioNode`)
- Raw `AudioNode` → uses `node` directly (since `node.input` is `undefined`)

## Options Considered

1. **Only support raw `AudioNode`**: Forces callers to unwrap library objects manually.
2. **Wrap `AudioNode` in a class**: Uniform type but requires every node to be wrapped; conflicts with `WebAudioContext.destination` and other native nodes.
3. **`connect()` + `input` protocol (chosen)**: Both sides are optional per class; the `??` fallback handles the mixed case.

## Rationale

The `??` pattern is a one-liner that requires no type system. It's discoverable: if an object has an `input` property, it's a "routable" library object. If not, it's a raw `AudioNode`. This keeps audio graph assembly code clean:

```js
acid.connect(delay);           // delay is a library FX object
delay.connect(ctx.destination); // ctx.destination is a raw AudioNode
acid.connect(analyser);        // AnalyserNode is a raw AudioNode
```

## Consequences

- Every new instrument or effect must implement `connect()` and `get input()` using this protocol.
- Callers must not bypass `connect()` and call `this._out.connect()` directly from outside the class.
- Effects that have no input (e.g., a pure generator) should expose `input` as `null` or omit it; callers should not connect to such objects.
