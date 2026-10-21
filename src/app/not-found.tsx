import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-lg border bg-white p-10 text-center">
      <p className="text-sm font-medium">This page or case doesn&apos;t exist.</p>
      <Link href="/disputes" className="mt-2 inline-block text-sm text-indigo-700 underline">
        Back to the queue
      </Link>
    </div>
  );
}
