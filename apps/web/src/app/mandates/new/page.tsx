import { CreateMandateWizard } from "@/components/mandate/create-mandate-wizard";

export default function NewMandatePage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <div className="mb-10">
        <span className="eyebrow">New mandate</span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white">
          Grant an agent a private, cryptographically enforceable mandate
        </h1>
      </div>
      <CreateMandateWizard />
    </div>
  );
}
