import Studio from "./Studio";
import KeyManager from "./components/KeyManager";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-8">
      <header className="flex items-center justify-between">
        <a href="./" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-sky-400 text-sm font-bold text-emerald-950">V</span>
          Vox
          <span className="-ml-2 bg-gradient-to-r from-emerald-400 to-sky-400 bg-clip-text text-transparent">a</span>
        </a>
        <span className="hidden text-xs text-neutral-500 sm:inline">Room plan → exact 3D → real shots</span>
      </header>

      <Studio />

      <footer className="flex flex-col items-center gap-3 pt-4 text-center text-xs text-neutral-600">
        <KeyManager />
        <span>The 3D model and its shots are built in your browser. Only plan reading, free-form commands and “Make realistic” use AI.</span>
      </footer>
    </main>
  );
}
