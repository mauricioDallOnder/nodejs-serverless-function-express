import type { VercelRequest, VercelResponse } from '@vercel/node';
import { IncomingForm, Fields, Files, File } from 'formidable';
import fs from 'fs/promises';

// Desabilita o body parser padrão para permitir o parsing do multipart/form-data
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Cabeçalhos CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Trata requisições pré-flight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  try {
    // Configura o IncomingForm com uploadDir e keepExtensions para garantir que o arquivo seja salvo
    const form = new IncomingForm({
      uploadDir: '/tmp',
      keepExtensions: true,
    });

    const { fields, files } = await new Promise<{ fields: Fields; files: Files }>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    // Extrai os campos enviados
    const category = fields.category as string;
    const key = fields.key as string;
    const nameField = fields.name as string;
    const descField = fields.desc as string;
   const imageFile = files.image as File;

if (!category || !key || !nameField || !descField || !imageFile) {
  res.status(400).json({ error: 'Campos obrigatórios não foram enviados.' });
  return;
}

// Log para depuração
console.log('Arquivo recebido:', JSON.stringify(imageFile, null, 2));

const filePath = imageFile.filepath;
console.log('Caminho do arquivo:', filePath); // Verifique no log da Vercel

if (!filePath) {
  res.status(400).json({ error: 'Caminho do arquivo não encontrado.' });
  return;
}

    // Lê o arquivo de imagem e converte para base64
    const imageData = await fs.readFile(filePath);
    const imageBase64 = imageData.toString('base64');

    // Recupera as variáveis de ambiente
    const REPO_OWNER = process.env.REPO_OWNER;
    const REPO_NAME = process.env.REPO_NAME;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

    if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
      res.status(500).json({ error: 'Variáveis de ambiente não configuradas.' });
      return;
    }

    // Define o caminho da imagem no repositório (na pasta "imgs")
    const imagePath = `imgs/${imageFile.originalFilename}`;
    const imageUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${imagePath}`;
    const commitMessageImage = `Adiciona nova imagem para ${key}`;

    // Envia a imagem via API do GitHub
    const uploadImageResponse = await fetch(imageUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: commitMessageImage,
        content: imageBase64
      })
    });

    if (!uploadImageResponse.ok) {
      const errorData = await uploadImageResponse.json();
      console.error('Erro no upload da imagem:', errorData);
      res.status(500).json({ error: 'Erro ao enviar a imagem para o GitHub', details: errorData });
      return;
    }

    // Atualiza o arquivo JSON (correctAnswers.json)
    const jsonPath = 'correctAnswers.json';
    const jsonUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${jsonPath}`;

    // Obtém o conteúdo atual do arquivo JSON
    const jsonResponse = await fetch(jsonUrl, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
    });
    if (!jsonResponse.ok) {
      const errorData = await jsonResponse.json();
      console.error('Erro ao obter o JSON:', errorData);
      res.status(500).json({ error: 'Erro ao obter o arquivo JSON do GitHub', details: errorData });
      return;
    }
    const jsonData = await jsonResponse.json();
    const sha = jsonData.sha;
    const currentContent = Buffer.from(jsonData.content, 'base64').toString('utf-8');
    let gameData: any;
    try {
      gameData = JSON.parse(currentContent);
    } catch (parseError) {
      console.error('Erro ao parsear JSON:', parseError);
      res.status(500).json({ error: 'Erro ao parsear o arquivo JSON' });
      return;
    }

    // Cria a categoria se não existir
    if (!gameData[category]) {
      gameData[category] = {};
    }

    // Adiciona a nova palavra à categoria
    gameData[category][key] = {
      name: nameField,
      img: imageFile.originalFilename, // nome do arquivo da imagem
      imgUrl: `./${imagePath}`,
      desc: descField
    };

    // Prepara o novo conteúdo JSON e converte para base64
    const updatedContent = JSON.stringify(gameData, null, 2);
    const updatedContentBase64 = Buffer.from(updatedContent).toString('base64');
    const commitMessageJSON = `Atualiza ${jsonPath} com a nova palavra ${key}`;

    // Atualiza o arquivo JSON via API do GitHub
    const updateJSONResponse = await fetch(jsonUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: commitMessageJSON,
        content: updatedContentBase64,
        sha: sha
      })
    });

    if (!updateJSONResponse.ok) {
      const errorData = await updateJSONResponse.json();
      console.error('Erro ao atualizar JSON:', errorData);
      res.status(500).json({ error: 'Erro ao atualizar o arquivo JSON no GitHub', details: errorData });
      return;
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro no processamento:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
