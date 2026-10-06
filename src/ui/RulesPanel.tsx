/** Riepilogo delle regole base (sintesi, non sostituisce il manuale). */
export function RulesPanel() {
  return (
    <div className="rules">
      <p className="muted small">
        Sintesi di consultazione delle regole base. Per i dettagli fate riferimento al vostro manuale. L'app applica automaticamente quanto riportato qui.
      </p>

      <details open>
        <summary>Sequenza di gioco</summary>
        <ol>
          <li>
            <b>Preparazione</b>: eserciti (circa 100–120 punti), lancio della moneta: chi vince prepara il terreno, l'altro sceglie il lato. Si tira per chi schiera per primo; schieramento entro 9" dal proprio bordo (entro 9" dai lati solo Schermagliatori e Cavalleria).
          </li>
          <li>
            <b>Fase di Manovra</b>: a turno ogni giocatore muove un'unità, formazione o comandante (azione gratuita, nessuna penalità in terreno buono). Finisce appena un'unità tira o attacca.
          </li>
          <li>
            <b>Fase di Battaglia</b>: si girano le carte del Mazzo di Gioco (una carta per Comandante, 2 Bonus, 2 Schermaglia e Artiglieria). L'ultima carta non si gioca mai.
          </li>
          <li>
            <b>Fine turno</b>: azioni gratuite (togli un Disordine o, per gli Arcieri, tira una volta) per le unità non attivate e non Scosse; Test di Crisi del Morale per le unità Scosse o a metà forza (salvo mischie in corso o vittorie senza perdite successive); si raccolgono gli Ordini e si rimescolano i mazzi.
          </li>
        </ol>
      </details>

      <details>
        <summary>Carte</summary>
        <ul>
          <li>
            <b>Comandante</b>: Ottuso 1, Comandante 2, Eroe 3 Segnalini Ordine. Ogni Segnalino: muovere se stesso, montare/smontare (una volta), dare un Ordine a un'unità entro 6" (solo il C-in-C può ordinare unità di altre Schiere), o riordinare l'unità a cui è aggregato.
          </li>
          <li>
            <b>Bonus</b>: alla prima Bonus del turno si combattono le mischie in corso. Poi spareggio 1D6: chi vince pesca dal mazzo Bonus (Vantaggio, Penalità, Ritira, Evento Speciale, Nessun effetto). Usala entro fine turno.
          </li>
          <li>
            <b>Schermagliatori e Artiglieria</b>: le unità di quel giocatore agiscono d'iniziativa con 2 azioni (se non hanno già ricevuto un Ordine).
          </li>
        </ul>
      </details>

      <details>
        <summary>Azioni (due per unità ordinata)</summary>
        <ul>
          <li>Muovi (incluso l'attacco), Converge (oltre 45° = Disordine), Dietro-front (Disordine), Tira (solo le Compagnie di Arcieri due volte), Riordina (serve un comandante aggregato: −1 Disordine; due Riordini tolgono Scossa).</li>
          <li>Aggancia/sgancia il pezzo: 2 azioni. Azioni speciali (formazioni, pali, smontare): 2 azioni.</li>
          <li>La Leva attacca solo con un comandante aggregato. Gli Schermagliatori (tranne i Kern) non attaccano.</li>
        </ul>
      </details>

      <details>
        <summary>Movimento</summary>
        <table className="tbl small">
          <thead>
            <tr>
              <th>Truppa</th>
              <th>Buono</th>
              <th>Difficile</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Comandante</td><td>8" a piedi / 12" a cavallo</td><td>6"</td></tr>
            <tr><td>Schermagliatori</td><td>8" (6" con pavesi)</td><td>8"</td></tr>
            <tr><td>Fanteria</td><td>6"</td><td>4" + Disordine</td></tr>
            <tr><td>Cavalieri</td><td>8"</td><td>4" + Disordine (mai nei boschi)</td></tr>
            <tr><td>Cavalleria leggera</td><td>10"</td><td>4" + Disordine</td></tr>
            <tr><td>Artiglieria</td><td>4"</td><td>—</td></tr>
            <tr><td>Carica (solo cavalleria)</td><td>+4"</td><td>—</td></tr>
          </tbody>
        </table>
        <ul className="small">
          <li>Fuori dall'arco frontale (45°) o di lato: Disordine (non Schermagliatori e Cavalleria leggera).</li>
          <li>Ostacoli (siepi, muri, torrenti): Disordine e fine del movimento. Pali e difese: la cavalleria prende 2 Disordini.</li>
          <li>Attraversare amici di arma diversa: Disordine a entrambi (gli Schermagliatori non disordinano nessuno).</li>
          <li>Massimo 2 Disordini per unità.</li>
        </ul>
      </details>

      <details>
        <summary>Tiro</summary>
        <table className="tbl small">
          <thead>
            <tr>
              <th>Tiratori</th>
              <th>Corta</th>
              <th>Lunga</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Compagnie di Arcieri</td><td>&lt; 9": 5+</td><td>9"–15": 6</td></tr>
            <tr><td>Schermagliatori</td><td>0–12": 5+</td><td>—</td></tr>
            <tr><td>Kern</td><td>6": 5+</td><td>—</td></tr>
            <tr><td>Cannone da campo</td><td>0–30": 6</td><td>—</td></tr>
            <tr><td>Pezzo pesante</td><td>0–36": 6</td><td>—</td></tr>
          </tbody>
        </table>
        <ul className="small">
          <li>Un dado per figura nei primi due ranghi (solo il primo se in Disordine o Scossa). Serventi d'artiglieria ×2. Metà dadi tra Schermagliatori/Artiglieria.</li>
          <li>Veterani arcieri ritirano gli 1. Artiglieria: tre o più 1 = il pezzo esplode. I colpi d'artiglieria uccidono sempre.</li>
          <li>Si tira sul bersaglio più vicino nell'arco di 45°, salvo comandante aggregato. Varchi di almeno 4". Arcieri: 6 tiri di frecce.</li>
        </ul>
        <table className="tbl small">
          <thead>
            <tr>
              <th>Armatura (contro il tiro)</th>
              <th>Salva</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Pesante: Uomini d'Arme</td><td>3+</td></tr>
            <tr><td>Media: Bill, Picche, Cavalieri</td><td>4+</td></tr>
            <tr><td>Leggera: Arcieri, Schermagliatori, Cav. leggera</td><td>5+</td></tr>
            <tr><td>Nessuna: Kern, fanteria di Leva</td><td>6</td></tr>
          </tbody>
        </table>
        <p className="small">Fanteria in copertura (pavesi, muri, abitati, boschi): +1 classe. Balestre e archibugi riducono gli Uomini d'Arme a Media.</p>
      </details>

      <details>
        <summary>Mischia</summary>
        <ul className="small">
          <li>Dadi per figura: Cavaliere 2, Uomo d'Arme e Cav. leggera 1,5, Bill/Picca/Kern 1, Arciere/Schermagliatore/Servente 0,5. Contano due ranghi (+ il terzo rango di supporto nei blocchi, primo e secondo round).</li>
          <li>Round 1: colpisce con 4+; veterani, attaccanti e chi insegue ritirano gli 1; Cavalieri in carica in piano ritirano 1–3.</li>
          <li>Round 2: 5+, ritira gli 1 solo chi ha vinto il primo; poi Disordine a entrambi. Round 3: nessun ritiro. Dopo tre round gli attaccanti ripiegano.</li>
          <li>Comandanti: +3/+2/+1 colpi automatici. Fianco/retro: mezzo rango (un blocco solo la fila d'estremità).</li>
          <li>Chi subisce più perdite perde e fa subito il Test del Morale. Cavalleria e Kern che non spezzano la fanteria al primo round si sganciano.</li>
        </ul>
        <table className="tbl small">
          <thead>
            <tr>
              <th>Salvezza in mischia</th>
              <th>Salva</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Cavalieri, Uomini d'Arme</td><td>3+</td></tr>
            <tr><td>Bill, Picche, Cav. leggera</td><td>4+</td></tr>
            <tr><td>Arcieri, Schermagliatori, Kern, Bill di Leva</td><td>5+</td></tr>
            <tr><td>Arcieri di Leva</td><td>6</td></tr>
          </tbody>
        </table>
      </details>

      <details>
        <summary>Test di Crisi del Morale</summary>
        <ul className="small">
          <li>Fanteria 2D6 (doppio 6 passa sempre, doppio 1 fallisce sempre), Cavalleria 1D6+1, Schermagliatori e Artiglieria 1D6.</li>
          <li>Ritira un 1: Veterani, Eroe o C-in-C aggregato, ha vinto una mischia. Ritira un 6: Disordine o Scossa, Leva, attaccata sul fianco/retro. Se si equivalgono, nessun ritiro.</li>
          <li>Risultato 5+ e superiore alle perdite totali subite: superato. 5+ ma non superiore: Scossa (ripiega di un movimento). 4 o meno: Rotta (fugge e lascia il campo).</li>
          <li>Quando: mischia persa, comandante ucciso o che abbandona, amico di valore pari o superiore annientato o in rotta entro 12" in vista, attacco di un'altra Schiera sul fianco di una mischia, fine turno se Scossa o a metà forza.</li>
        </ul>
      </details>

      <details>
        <summary>Vittoria e Morale d'Armata</summary>
        <ul className="small">
          <li>Gettoni iniziali: uno per Compagnia e Squadrone (esclusi Schermagliatori e Artiglieria).</li>
          <li>Il nemico ne prende 1 quando una tua unità diventa Scossa, 1 se un'unità già Scossa è distrutta, in rotta o esce dal tavolo, 2 se lo era un'unità non Scossa. Ne recuperi 1 riordinando un'unità Scossa.</li>
          <li>Si vince quando l'avversario deve cedere un gettone e non ne ha più, uccidendo il C-in-C nemico, o per resa.</li>
        </ul>
      </details>

      <details>
        <summary>Comandanti</summary>
        <ul className="small">
          <li>Ferite pari alla classe; ogni ferita fa scendere di una classe. Se il C-in-C muore, la partita è persa.</li>
          <li>Rischio: unità con comandante che subisce più di 3 perdite (più di 2 dal tiro se a cavallo): 1D6 per ogni perdita in più, ogni 1 è una ferita. Unità annientata in mischia: il comandante muore.</li>
          <li>Duello tra C-in-C nella stessa mischia: si accetta (2 scontri su 3, l'Eroe vince il primo contro un non-Eroe) o si abbandona la mischia (Test del Morale).</li>
        </ul>
      </details>
    </div>
  );
}
