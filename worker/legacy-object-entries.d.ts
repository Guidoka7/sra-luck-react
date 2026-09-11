export {};

declare global {
  interface ObjectConstructor {
    /** Compatibilidade temporária com handlers legados que usam mapas dinâmicos. */
    entries(o: any): [string, any][];
  }
}
