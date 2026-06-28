import PlanToThreeD from "./PlanToThreeD";
import ApiKeyBar from "./components/ApiKeyBar";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          planto<span className="text-emerald-400">3d</span>
        </h1>
        <p className="text-sm text-neutral-400">
          Upload a 2D floor plan, set a style, generate an axonometric overview,
          then turn any room into a photorealistic interior — the prompt is
          auto-written and fully editable, regenerate until you like it.
        </p>
      </header>
      <ApiKeyBar />
      <PlanToThreeD />
    </main>
  );
}
