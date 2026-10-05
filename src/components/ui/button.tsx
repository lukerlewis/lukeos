import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:opacity-90 disabled:border disabled:border-border disabled:bg-muted disabled:text-disabled dark:disabled:bg-sidebar",
        outline:
          "border border-stroke bg-card text-subtle-foreground hover:bg-muted dark:bg-muted dark:hover:bg-selected disabled:border-border disabled:bg-muted disabled:text-disabled dark:disabled:bg-sidebar",
        ghost: "text-subtle-foreground hover:bg-muted hover:text-foreground disabled:text-disabled",
        // Deleting stays grey until you point at it.
        danger: "text-muted-foreground hover:bg-muted hover:text-danger disabled:text-disabled",
      },
      size: {
        sm: "h-9 px-3 text-preview",
        md: "h-11 px-4 text-control",
        lg: "h-11 px-5 text-control",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
