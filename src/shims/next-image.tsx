import type { ImgHTMLAttributes } from "react";

type Props = ImgHTMLAttributes<HTMLImageElement> & { src: string | { src: string }; fill?: boolean; priority?: boolean; quality?: number };

export default function Image({ src, fill, priority: _priority, quality: _quality, ...props }: Props) {
  const resolved = typeof src === "string" ? src : src.src;
  return <img src={resolved} {...(fill ? { style: { ...props.style, width: "100%", height: "100%", objectFit: "contain" } } : {})} {...props} />;
}
