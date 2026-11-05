import { UploadDropzone } from "@/components/UploadDropzone";
import { t } from "@/lib/strings";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <p className="text-sm font-semibold tracking-wide text-accent">{t.appName}</p>
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{t.upload.title}</h1>
        <p className="mt-2 text-muted">{t.tagline}</p>
      </div>
      <UploadDropzone />
    </main>
  );
}
