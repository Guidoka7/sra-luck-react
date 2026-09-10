import type { AnchorHTMLAttributes, ReactNode } from "react";

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode; prefetch?: boolean };

export default function Link({ href, children, onClick, prefetch: _prefetch, ...props }: Props) {
  return (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          window.history.pushState({}, "", href);
          window.dispatchEvent(new Event("app:navigate"));
        }
        onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}
