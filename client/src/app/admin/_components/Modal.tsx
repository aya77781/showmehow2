"use client";

export function Modal({
  children,
  onClose,
  title,
  size = "md",
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  size?: "md" | "lg" | "xl";
}) {
  const maxW = size === "xl" ? "max-w-4xl" : size === "lg" ? "max-w-2xl" : "max-w-md";
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className={`w-full ${maxW} max-h-[90vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl p-6`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
