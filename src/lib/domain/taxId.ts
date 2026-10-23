const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_LETTERS = 'JABCDEFGHI';

export function normalizeTaxId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function dniLetterOk(digits: string, letter: string): boolean {
  return DNI_LETTERS[Number(digits) % 23] === letter;
}

function cifOk(id: string): boolean {
  const [, type, digits, control] = id.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/) ?? [];
  if (!type) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const n = Number(digits[i]);
    if (i % 2 === 0) {
      const doubled = n * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += n;
    }
  }
  const check = (10 - (sum % 10)) % 10;
  const asLetter = CIF_LETTERS[check];
  if ('PQRSNW'.includes(type)) return control === asLetter;
  if ('ABEH'.includes(type)) return control === String(check);
  return control === String(check) || control === asLetter;
}

/** Spanish NIF (DNI), NIE or CIF with its control character. Accepts an optional "ES" prefix. */
export function isValidSpanishTaxId(value: string): boolean {
  let id = normalizeTaxId(value);
  if (id.length === 11 && id.startsWith('ES')) id = id.slice(2);
  if (id.length !== 9) return false;

  const dni = id.match(/^(\d{8})([A-Z])$/);
  if (dni) return dniLetterOk(dni[1], dni[2]);

  const nie = id.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (nie) return dniLetterOk(String('XYZ'.indexOf(nie[1])) + nie[2], nie[3]);

  return cifOk(id);
}
