import { updatepurchaseStateByID } from "../dbFunctionality/functionality.js";

/**
 * Detecta “muletillas” en el mensaje y actualiza purchase_state.
 * @param {string} message    Texto recibido (puede tener tildes/casos)
 * @param {string} messageTo  CustomerId / phone
 */
export async function muletillas(message = "", messageTo) {
  const raw = String(message || "");
  const text = raw
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  //console.log(`[Muletillas] Incoming message from ${messageTo}: "${raw}"`);
  //console.log(`[Muletillas] Normalized: "${text}"`);

  const rules = [
    {
      name: "PAGO AL RECOGER / AL RECIBIR",
      test: (t) =>
        t.includes("depositarnos como adelanto:") ||
        t.includes("solo depositar el envio"),
      action: () => updatepurchaseStateByID(messageTo, 3),
      nextState: 3,
    },
    {
      name: "CONFIRMAR PRODUCTO / DATOS PERSONALES",
      test: (t) =>
        t.includes("su envio ya esta registrado") ||
        t.includes("2.nombres apellidos completos:"),
      action: () => updatepurchaseStateByID(messageTo, 4, true),
      nextState: 4,
    },
    {
      name: "CONFIRMAR PRODUCTO / DATOS PERSONALES",
      test: (t) =>
        t.includes("su clave es") ||
        t.includes("*su entrega esta registrada*"),
      action: () => updatepurchaseStateByID(messageTo, 5, true),
      nextState: 5,
    },
  ];

  for (const { name, test, action, nextState } of rules) {
    if (test(text)) {
      //console.log(`[Muletillas] Matched rule: ${name}`);
     // console.log(`[Muletillas] Updating purchase_state → ${nextState}`);

      await action();

      //console.log(`[Muletillas] Update complete for ${messageTo}`);
      return; // stops processing
    }
  }

 // console.log(`[Muletillas] No rules matched for this message.`);
}
