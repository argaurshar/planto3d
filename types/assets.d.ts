// Python sources imported as text (next.config.js: `asset/source` for *.py),
// e.g. the shared Blender renderer embedded in the "Download for Blender" package.
declare module "*.py" {
  const source: string;
  export default source;
}
