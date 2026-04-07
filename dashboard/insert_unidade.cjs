const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envContent = fs.readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...vParts] = line.split('=');
  if (k && vParts.length) {
    env[k.trim()] = vParts.join('=').trim();
  }
});

const supaUrl = env.VITE_SUPABASE_URL;
const supaKey = env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supaUrl, supaKey);

async function main() {
  console.log("Checando unidades cadastradas...");
  const { data: unidades, error } = await supabase.from('etp_unidades').select('*');
  
  if (error) {
    console.error("Erro ao buscar unidades:", error);
    return;
  }

  if (!unidades || unidades.length === 0) {
    console.log("Nenhuma unidade encontrada! Cadastrando a Unidade Gravatá padrao...");
    
    const novaUnidade = {
      cnpj: '00.000.000/0001-00', // fictício pois não tivemos acesso a esse dado exato
      nome: 'Gravatá',
      cor: '#6366f1',
      codigo_sponte: '35695',
      token_sponte: 'fxW1Et2vS8Vf',
      ativo: true
    };

    const { data: inserted, error: insertError } = await supabase
      .from('etp_unidades')
      .insert([novaUnidade])
      .select();
      
    if (insertError) {
      console.error("Erro ao cadastrar unidade:", insertError);
    } else {
      console.log("Unidade cadastrada com sucesso!", inserted[0]);
    }
  } else {
    console.log(`Unidades já cadastradas: ${unidades.map(u => u.nome).join(', ')}`);
  }
}

main();
