<div alt style="text-align: center; transform: scale(.25);">
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="https://github.com/tsdraw/tsdraw/raw/main/assets/hero-dark.png" />
		<img alt="tsdraw" src="https://github.com/tsdraw/tsdraw/raw/main/assets/hero-light.png" />
	</picture>
</div>

<h3 align="center">
  React components and hooks for the tsdraw library<br>
  <sub><sup>(inspired by excalidraw and tldraw)</sup></sub>
</h3>

## Highlights

`@tsdraw/react` provides React components and hooks for the tsdraw core engine.

- **React components**: Pre-built `<Tsdraw />` and `<TsdrawCanvas />` components
- **hooks**: Access the drawing API from React components via `onMount`
- **built-in toolbar**: Customizable toolbar with tools and actions
- **style panel**: Element styling UI out of the box
- **custom elements**: Render custom React elements on the canvas
- **custom tools**: Build and integrate your own tools
- **tremendously small**: Made to be small and load instantly when needed

## Usage

**Before using this library, I HIGHLY recommend checking out (and maybe cloning) the [demo project](https://github.com/tsdraw/tsdraw/tree/main/apps/demo), which shows off basically everything you can do with this library.**

```bash
npm install @tsdraw/react @tsdraw/core
```

```tsx
import { Tsdraw } from '@tsdraw/react';
import '@tsdraw/react/tsdraw.css';

function App() {
  return (
    <Tsdraw
      style={{ width: '100vw', height: '100vh' }}
      onMount={({ api }) => {
        // Example of how you could access the editor API
        api.setTool('pen');
      }}
    />
  );
}
```

## Components

### `<Tsdraw />`

Full-featured drawing component with built-in toolbar and UI.

```tsx
import { Tsdraw } from '@tsdraw/react';

<Tsdraw
  // Optional: customize UI
  uiOptions={{
    toolbar: { placement: 'top' },
  }}
  // Optional: handle mount
  onMount={({ api, editor }) => {
    // Access editor instance
  }}
/>;
```

### `<TsdrawCanvas />`

Canvas-only component for custom UI implementations.

```tsx
import { TsdrawCanvas } from '@tsdraw/react';

<TsdrawCanvas
  onMount={({ api }) => {
    // Set up custom controls
  }}
/>;
```

## Styling

Import the required CSS file:

```tsx
import '@tsdraw/react/tsdraw.css';
```

## Customization

### Custom Toolbar Items

```tsx
<Tsdraw
  uiOptions={{
    toolbar: {
      parts: [
        { type: 'tool', tool: 'pen' },
        { type: 'action', action: 'clear' },
        { type: 'custom', render: () => <MyButton /> },
      ],
    },
  }}
/>
```

### Custom Elements

```tsx
<Tsdraw
  customElements={[
    {
      id: 'my-element',
      render: ({ x, y, width, height }) => (
        <div style={{ position: 'absolute', left: x, top: y, width, height }}>
          Custom Content
        </div>
      ),
    },
  ]}
/>
```