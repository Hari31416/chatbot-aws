import * as React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link"
    | "glow";
  size?: "default" | "sm" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className = "", variant = "default", size = "default", ...props },
    ref,
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50 active:scale-98";

    const variants = {
      default:
        "bg-blue-600 text-white shadow-sm hover:bg-blue-500 hover:shadow-blue-500/10",
      destructive:
        "bg-red-600 text-white shadow-sm hover:bg-red-500 hover:shadow-red-500/10",
      outline:
        "border border-zinc-200 bg-white text-zinc-900 shadow-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900",
      secondary:
        "bg-zinc-100 text-zinc-900 shadow-xs hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-700",
      ghost:
        "text-zinc-950 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
      link: "text-blue-600 underline-offset-4 hover:underline dark:text-blue-450",
      glow: "bg-blue-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.4)] hover:bg-blue-500 hover:shadow-[0_0_15px_rgba(37,99,235,0.6)] transition-all duration-300",
    };

    const sizes = {
      default: "h-10 px-4 py-2",
      sm: "h-8 rounded-md px-3 text-xs",
      lg: "h-12 rounded-xl px-8 text-base",
      icon: "h-10 w-10",
    };

    const combinedClass = [
      baseStyles,
      variants[variant],
      sizes[size],
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return <button ref={ref} className={combinedClass} {...props} />;
  },
);

Button.displayName = "Button";
