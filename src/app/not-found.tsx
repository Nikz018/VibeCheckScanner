import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-20">
      <h1 className="font-display text-5xl">That page is not here.</h1>
      <Link href="/" className="btn btn-lime mt-6">
        Back home
      </Link>
    </div>
  );
}
