<div alt style="text-align: center; transform: scale(.25);">
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="https://github.com/tsdraw/tsdraw/raw/main/assets/hero-dark.png" />
		<img alt="tsdraw" src="https://github.com/tsdraw/tsdraw/raw/main/assets/hero-light.png" />
	</picture>
</div>

<h3 align="center">
  The core engine for tsdraw - framework-agnostic drawing library<br>
  <sub><sup>(inspired by excalidraw and tldraw)</sup></sub>
</h3>

## Feature highlights

`@tsdraw/core` is the framework-agnostic foundation of tsdraw with a state-based tool architecture.

- **state-based tools**: Tools are built as state machines for predictable interaction handling
- **framework-agnostic**: Use with any UI framework or vanilla JavaScript
- **built-in tools**: Pen, shapes (square, circle), eraser, select, and hand/pan tools
- **shape recognition**: Auto-recognize hand-drawn shapes
- **viewport & camera**: Pan and zoom with built-in camera controls
- **tremendously small**: Made to be small and load instantly when needed

## Usage

```bash
npm install @tsdraw/core
```

```typescript
import { Editor, createDocumentStore } from '@tsdraw/core';

// Create a document store
const store = createDocumentStore();

// Initialize the editor
const editor = new Editor({
  store,
  container: document.getElementById('canvas'),
});

// Set the active tool
editor.toolManager.setTool('pen');
```

## Tools

| Tool | Description |
|------|-------------|
| `pen` | Freehand drawing with pressure support via perfect-freehand |
| `square` | Rectangle/square shapes |
| `circle` | Circle and ellipse shapes |
| `eraser` | Erase elements with configurable size |
| `select` | Select and manipulate elements |
| `hand` | Pan and navigate the canvas |

## API Overview

### Core Classes

- `Editor` - Main editor instance that orchestrates all systems
- `DocumentStore` - Central state management for the drawing document
- `ToolManager` - Manages tool registration and activation
- `InputManager` - Handles pointer/touch input events
- `Renderer` - Renders the canvas and elements

### Utilities

- `pathCodec` - Encode/decode path data
- `geometry` - Geometric calculations and helpers
- `colors` - Color utilities and constants
- `shapeRecognition` - Hand-drawn shape recognition
- `snapshots` - Save and restore document state