/**
 * Importador da planilha de uniformes Grupo Velper.
 * Estrutura esperada: abas Aço | Arutec | Pinheirinho
 * Colunas: Mês | Item | Descrição/Modelo | P | M | G | GG | XG | XGG | Total | Valor gasto |
 *          Pedido/NF | Fornecedor | Data do pedido | Prazo de entrega |
 *          Data de recebimento | Situação | Observações
 *
 * USO:
 *   dry-run (somente validação):
 *     node --experimental-strip-types scripts/importar-uniformes.ts planilha.xlsx
 *
 *   importação real:
 *     CONFIRMAR=sim node --experimental-strip-types scripts/importar-uniformes.ts planilha.xlsx
 *
 * Regra crítica: pedidos SEM data de recebimento confirmada NÃO adicionam estoque.
 */

import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

// ── Leitura de secrets ────────────────────────────────────────
function readSecret(env: string, file: string): string {
  if (process.env[env]) return process.env[env]!;
  const fp = path.join(process.cwd(), file);
  if (fs.existsSync(fp)) return fs.readFileSync(fp, 'utf8').trim();
  throw new Error(`Secret ${env} não encontrado (env ou ${file})`);
}

const SUPABASE_URL          = readSecret('SUPABASE_URL',          '_supabase-url.local.txt');
const SUPABASE_SERVICE_ROLE = readSecret('SUPABASE_SERVICE_ROLE', '_supabase-service.local.txt');
const DRY_RUN               = process.env['CONFIRMAR'] !== 'sim';
const PLANILHA_PATH         = process.argv[2];

if (!PLANILHA_PATH) {
  console.error('Uso: node --experimental-strip-types scripts/importar-uniformes.ts <arquivo.xlsx>');
  process.exit(1);
}
if (!fs.existsSync(PLANILHA_PATH)) {
  console.error(`Arquivo não encontrado: ${PLANILHA_PATH}`);
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// ── Tipos ─────────────────────────────────────────────────────
interface PlanRow {
  plant: string;
  mes: string;
  item: string;
  modelo: string;
  tamanhos: Record<string, number>;  // { P: 10, M: 5, ... }
  total: number;
  valor: number;
  pedido_nf: string;
  fornecedor: string;
  data_pedido: string | null;
  prazo_entrega: string | null;
  data_recebimento: string | null;
  situacao: string;
  obs: string;
}

interface ImportReport {
  total_rows: number;
  pedidos_identificados: number;
  total_pecas: number;
  total_valor: number;
  sem_recebimento: string[];
  erros: string[];
  importados: number;
  ignorados: number;
}

// ── Parse de data Excel ───────────────────────────────────────
function parseDate(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return null;
    // dd/mm/yyyy → yyyy-mm-dd
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    return s;
  }
  if (typeof val === 'number') {
    // Número serial do Excel
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  return null;
}

function parseBRL(val: unknown): number {
  if (!val) return 0;
  const s = String(val).replace(/[R$\s.]/g,'').replace(',','.');
  return parseFloat(s) || 0;
}

const SIZES = ['P','M','G','GG','XG','XGG'];

// ── Leitura da planilha ───────────────────────────────────────
function lerPlanilha(filePath: string): PlanRow[] {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const PLANT_TABS: Record<string, string> = {
    'Aço': 'Aço', 'Arutec': 'Arutec', 'Pinheirinho': 'Pinheirinho',
    'ACO': 'Aço', 'ARU': 'Arutec', 'PIN': 'Pinheirinho',
  };
  const rows: PlanRow[] = [];

  for (const [sheetName, plantName] of Object.entries(PLANT_TABS)) {
    if (!wb.SheetNames.includes(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Encontrar linha de cabeçalho
    let headerRow = -1;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i] as string[];
      if (row.some(c => String(c).toLowerCase().includes('item'))) {
        headerRow = i;
        break;
      }
    }
    if (headerRow < 0) { console.warn(`Aba ${sheetName}: cabeçalho não encontrado.`); continue; }

    const headers = (data[headerRow] as string[]).map(h => String(h).toLowerCase().trim());
    const col = (name: string) => headers.indexOf(name);
    const get = (row: unknown[], name: string) => String((row as unknown[])[col(name)] ?? '').trim();

    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i] as unknown[];
      const item = get(row, 'item');
      if (!item) continue;

      const tamanhos: Record<string, number> = {};
      for (const sz of SIZES) {
        const idx = headers.findIndex(h => h === sz.toLowerCase());
        if (idx >= 0) {
          const v = parseInt(String(row[idx])) || 0;
          if (v > 0) tamanhos[sz] = v;
        }
      }

      rows.push({
        plant:            plantName,
        mes:              get(row, 'mês') || get(row, 'mes'),
        item,
        modelo:           get(row, 'descrição') || get(row, 'descricao') || get(row, 'modelo'),
        tamanhos,
        total:            parseInt(get(row, 'total')) || 0,
        valor:            parseBRL(get(row, 'valor gasto') || get(row, 'valor')),
        pedido_nf:        get(row, 'pedido / nf') || get(row, 'pedido/nf') || get(row, 'pedido'),
        fornecedor:       get(row, 'fornecedor'),
        data_pedido:      parseDate(row[headers.findIndex(h => h.includes('data') && h.includes('pedido'))]),
        prazo_entrega:    parseDate(row[headers.findIndex(h => h.includes('prazo'))]),
        data_recebimento: parseDate(row[headers.findIndex(h => h.includes('recebimento'))]),
        situacao:         get(row, 'situação') || get(row, 'situacao'),
        obs:              get(row, 'observações') || get(row, 'observacoes') || get(row, 'obs'),
      });
    }
  }
  return rows;
}

// ── Agrupar por pedido ────────────────────────────────────────
function agruparPorPedido(rows: PlanRow[]) {
  const map = new Map<string, { rows: PlanRow[]; plant: string; po: string }>();
  for (const r of rows) {
    const key = `${r.plant}||${r.pedido_nf || '__sem_pedido__'}`;
    if (!map.has(key)) map.set(key, { rows: [], plant: r.plant, po: r.pedido_nf });
    map.get(key)!.rows.push(r);
  }
  return map;
}

// ── Buscar IDs do banco ───────────────────────────────────────
async function carregarMestres() {
  const [{ data: plants }, { data: items }, { data: sizes }, { data: suppliers }] = await Promise.all([
    sb.from('unif_plants').select('id,name,code'),
    sb.from('unif_items').select('id,name'),
    sb.from('unif_sizes').select('id,code'),
    sb.from('unif_suppliers').select('id,name'),
  ]);
  const plantByName  = new Map((plants  || []).map((p: {id:string;name:string;code:string}) => [p.name.toLowerCase(), p.id]));
  const plantByCode  = new Map((plants  || []).map((p: {id:string;name:string;code:string}) => [p.code.toLowerCase(), p.id]));
  const itemByName   = new Map((items   || []).map((i: {id:string;name:string}) => [i.name.toLowerCase(), i.id]));
  const sizeByCode   = new Map((sizes   || []).map((s: {id:string;code:string}) => [s.code.toUpperCase(), s.id]));
  const suppByName   = new Map((suppliers || []).map((s: {id:string;name:string}) => [s.name.toLowerCase(), s.id]));
  return { plantByName, plantByCode, itemByName, sizeByCode, suppByName };
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Importador de Uniformes Velper ===');
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (sem escrita)' : '⚠️  IMPORTAÇÃO REAL'}`);
  console.log(`Arquivo: ${PLANILHA_PATH}\n`);

  const rows  = lerPlanilha(PLANILHA_PATH);
  const pedidos = agruparPorPedido(rows);
  const { plantByName, plantByCode, itemByName, sizeByCode, suppByName } = await carregarMestres();

  const report: ImportReport = {
    total_rows: rows.length,
    pedidos_identificados: pedidos.size,
    total_pecas: rows.reduce((s,r) => s + r.total, 0),
    total_valor: rows.reduce((s,r) => s + r.valor, 0),
    sem_recebimento: [],
    erros: [],
    importados: 0,
    ignorados: 0,
  };

  // ── VALIDAÇÕES ESPERADAS ─────────────────────────────────────
  // Spec: 3 pedidos, 6 linhas de itens, 460 peças, R$ 17.155,00
  const EXPECTED = {
    pedidos:   3,
    linhas:    6,
    pecas:     460,
    valor:     17155.00,
    fornecedor:'Viva Vida Confecções Ltda.',
    po_list:   ['0128000573/00','0128000568/00','0102000005/00'],
  };

  console.log('── Validação da planilha ──');
  console.log(`  Linhas lidas:            ${rows.length}          (esperado: ${EXPECTED.linhas})`);
  console.log(`  Pedidos agrupados:       ${pedidos.size}             (esperado: ${EXPECTED.pedidos})`);
  console.log(`  Total de peças:          ${report.total_pecas}          (esperado: ${EXPECTED.pecas})`);
  console.log(`  Valor total (R$):        ${report.total_valor.toFixed(2).replace('.',',')}   (esperado: R$ 17.155,00)`);

  for (const po of EXPECTED.po_list) {
    const found = [...pedidos.values()].some(p => p.po.includes(po.replace(/\//g,'')||po));
    console.log(`  Pedido ${po}: ${found ? '✓ encontrado' : '✗ NÃO encontrado'}`);
  }
  console.log('');

  // ── Processar cada pedido ────────────────────────────────────
  for (const [key, grupo] of pedidos.entries()) {
    const ref = grupo.rows[0];
    const plantId = plantByName.get(grupo.plant.toLowerCase())
                 || plantByCode.get(grupo.plant.toLowerCase());
    if (!plantId) {
      report.erros.push(`Planta não mapeada: "${grupo.plant}" (pedido ${grupo.po})`);
      report.ignorados++;
      continue;
    }

    // Fornecedor
    const suppName = ref.fornecedor.toLowerCase();
    const suppId   = suppByName.get(suppName)
                  || [...suppByName.entries()].find(([k]) => k.includes(suppName))?.[1];

    // Datas
    const dataRecebimento = ref.data_recebimento;
    const semRecebimento  = !dataRecebimento;
    if (semRecebimento) {
      report.sem_recebimento.push(`${grupo.plant} — ${grupo.po || '(sem nº)'}`);
    }

    // Linhas de item
    const orderItems: { item_id: string; size_id: string; qty: number; unit_value: number }[] = [];
    for (const row of grupo.rows) {
      const itemId = itemByName.get(row.item.toLowerCase());
      if (!itemId) {
        report.erros.push(`Item não mapeado: "${row.item}" (planta ${row.plant}, pedido ${row.pedido_nf})`);
        continue;
      }
      for (const [sz, qty] of Object.entries(row.tamanhos)) {
        const sizeId = sizeByCode.get(sz);
        if (!sizeId) { report.erros.push(`Tamanho não mapeado: ${sz}`); continue; }
        orderItems.push({ item_id: itemId, size_id: sizeId, qty,
          unit_value: row.total > 0 ? row.valor / row.total : 0 });
      }
    }

    const totalPecas = orderItems.reduce((s,i) => s + i.qty, 0);
    const totalValor = ref.valor;

    console.log(`Pedido: ${grupo.plant} — ${grupo.po || '(sem nº)'}`);
    console.log(`  Fornecedor: ${ref.fornecedor || '—'} (ID: ${suppId || 'não encontrado'})`);
    console.log(`  Data pedido: ${ref.data_pedido || '—'} | Prazo: ${ref.prazo_entrega || '—'}`);
    console.log(`  Recebimento: ${dataRecebimento || '❌ NÃO CONFIRMADO — NÃO entrará no estoque'}`);
    console.log(`  Peças: ${totalPecas} | Valor: R$ ${totalValor.toFixed(2).replace('.',',')}`);
    console.log(`  Itens: ${orderItems.map(i => `${i.qty}un`).join(', ')}`);

    if (DRY_RUN) {
      console.log(`  → DRY-RUN: nada escrito.\n`);
      report.importados++;
      continue;
    }

    // ── ESCRITA REAL ─────────────────────────────────────────
    // 1. Inserir pedido de compra
    const { data: po, error: poErr } = await sb.from('unif_purchase_orders').insert({
      plant_id:     plantId,
      supplier_id:  suppId || null,
      po_number:    grupo.po || null,
      order_date:   ref.data_pedido || null,
      expected_date:ref.prazo_entrega || null,
      status:       semRecebimento ? 'aguardando_recebimento' : 'recebido',
      total_value:  totalValor || null,
      obs:          ref.obs || null,
    }).select('id').single();

    if (poErr || !po) {
      report.erros.push(`Erro ao inserir pedido ${grupo.po}: ${poErr?.message}`);
      report.ignorados++;
      continue;
    }

    // 2. Inserir linhas do pedido
    const poItems = orderItems.map(i => ({
      order_id:    po.id,
      item_id:     i.item_id,
      size_id:     i.size_id,
      qty_ordered: i.qty,
      qty_received:semRecebimento ? 0 : i.qty,
      unit_value:  i.unit_value || null,
    }));
    await sb.from('unif_purchase_order_items').insert(poItems);

    // 3. Se tem recebimento confirmado → criar recebimento e adicionar ao estoque
    if (!semRecebimento) {
      const { data: rec } = await sb.from('unif_receipts').insert({
        order_id:     po.id,
        plant_id:     plantId,
        receipt_date: dataRecebimento,
        obs:          'Importação da planilha inicial',
      }).select('id').single();

      if (rec) {
        await sb.from('unif_receipt_items').insert(
          orderItems.map(i => ({ receipt_id: rec.id, item_id: i.item_id, size_id: i.size_id, qty_received: i.qty }))
        );
        // Upsert no estoque
        for (const i of orderItems) {
          await sb.rpc('confirmar_recebimento', {
            p_order_id: po.id, p_nf_number: null, p_obs: 'Importação inicial',
            p_items: [{ item_id: i.item_id, size_id: i.size_id, qty_received: i.qty }],
            p_user_id: null,
          }).then(() => {}); // não fatal se já executado
        }
      }
    }

    report.importados++;
    console.log(`  → Importado: pedido ID ${po.id}\n`);
  }

  // ── RELATÓRIO FINAL ──────────────────────────────────────────
  console.log('\n══ RELATÓRIO DE IMPORTAÇÃO ══');
  console.log(`  Linhas lidas:             ${report.total_rows}`);
  console.log(`  Pedidos identificados:    ${report.pedidos_identificados}`);
  console.log(`  Total de peças:           ${report.total_pecas}`);
  console.log(`  Valor total importado:    R$ ${report.total_valor.toFixed(2).replace('.',',')}`);
  console.log(`  Importados com sucesso:   ${report.importados}`);
  console.log(`  Ignorados/erros:          ${report.ignorados}`);

  if (report.sem_recebimento.length > 0) {
    console.log(`\n  ⚠️  Pedidos SEM recebimento confirmado (NÃO entraram no estoque):`);
    report.sem_recebimento.forEach(p => console.log(`     - ${p}`));
  }
  if (report.erros.length > 0) {
    console.log(`\n  ❌ Erros/inconsistências:`);
    report.erros.forEach(e => console.log(`     - ${e}`));
  }

  if (DRY_RUN) {
    console.log('\n→ Modo DRY-RUN: nenhum dado foi escrito no banco.');
    console.log('  Para importar de verdade: CONFIRMAR=sim node --experimental-strip-types scripts/importar-uniformes.ts planilha.xlsx');
  } else {
    console.log('\n→ Importação REAL concluída.');
    console.log('  Confirme os dados no painel: Uniformes → Compras');
  }
}

main().catch(err => { console.error('\n❌ Erro fatal:', err.message); process.exit(1); });
