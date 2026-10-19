import { CreateMandateWizard } from "@/components/mandate/create-mandate-wizard";

export default function NewMandatePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="mb-10">
        <span className="eyebrow">New mandate</span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-900">
          Grant an agent a private, <span className="gradient-text">cryptographically enforceable</span> mandate
        </h1>
      </div>
      <CreateMandateWizard />
    </div>
  );
}
