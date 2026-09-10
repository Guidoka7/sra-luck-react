/** Mantém apenas dígitos */
export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/** Formata 11 dígitos como 000.000.000-00 */
export function formatarCpf(valor: string): string {
  const d = apenasDigitos(valor).slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

/** Validação de CPF (dígitos verificadores) */
export function cpfValido(valorBruto: string): boolean {
  const cpf = apenasDigitos(valorBruto);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calcDigito = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += parseInt(base[i], 10) * (pesoInicial - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const d1 = calcDigito(cpf.slice(0, 9), 10);
  const d2 = calcDigito(cpf.slice(0, 10), 11);
  return d1 === parseInt(cpf[9], 10) && d2 === parseInt(cpf[10], 10);
}
