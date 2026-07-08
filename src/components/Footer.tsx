import Image from "next/image";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-border theme8bit:border-t-4 theme8bit:border-black theme8bit:uppercase theme8bit:shadow-[0_-4px_0_#000]">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-3 px-4 py-8 sm:flex-row sm:justify-between sm:px-6 theme8bit:py-6">
        <div className="flex items-center gap-3">
          <Image
            src="/coding-hwaesa-logo.png"
            alt="Coding Hwaesa logo"
            width={40}
            height={40}
            className="h-10 w-10 object-contain theme8bit:h-8 theme8bit:w-8"
          />
          <span className="text-base font-semibold tracking-tight theme8bit:text-xs theme8bit:tracking-widest">
            Coding Hwaesa
          </span>
        </div>
        <p className="text-xs text-muted-foreground theme8bit:text-[10px] theme8bit:tracking-wide">
          &copy; {new Date().getFullYear()} Coding Hwaesa. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
