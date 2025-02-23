import type { VercelRequest, VercelResponse } from '@vercel/node';
import { IncomingForm, Fields, Files, File } from 'formidable';
import fs from 'fs/promises';

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
    // Configura o IncomingForm para upload no diretório /tmp (permitido no ambiente serverless)
    const form = new IncomingForm({
      uploadDir: '/tmp',
      keepExtensions: true,
      multiples: false,
    });

    const { fields, files } = await new Promise<{ fields: Fields; files: Files }>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    // Extrai os campos obrigatórios
    const category = fields.category as string;
    const key = fields.key as string;
    const nameField = fields.name as string | string[];
    const descField = fields.desc as string | string[];

    if (!category || !key || !nameField || !descField) {
      res.status(400).json({ error: 'Campos obrigatórios não foram enviados.' });
      return;
    }

    // Recupera as variáveis de ambiente
    const REPO_OWNER = process.env.REPO_OWNER;
    const REPO_NAME = process.env.REPO_NAME;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
      res.status(500).json({ error: 'Variáveis de ambiente não configuradas.' });
      return;
    }

    // URL do arquivo JSON no GitHub
    const jsonPath = 'correctAnswers.json';
    const jsonUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${jsonPath}`;

    // Busca o arquivo JSON atual no GitHub
    const jsonResponse = await fetch(jsonUrl, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
    });
    if (!jsonResponse.ok) {
      const errorData = await jsonResponse.json();
      res.status(500).json({ error: 'Erro ao obter o arquivo JSON do GitHub', details: errorData });
      return;
    }
    const jsonData = await jsonResponse.json();
    const shaJson = jsonData.sha;
    let currentContent = Buffer.from(jsonData.content, 'base64').toString('utf-8');
    // Se o conteúdo estiver vazio, inicializa com objeto vazio
    let gameData: any = {};
    if (currentContent.trim() !== '') {
      try {
        gameData = JSON.parse(currentContent);
      } catch (parseError) {
        console.error('Erro ao parsear JSON:', parseError, 'Conteúdo:', currentContent);
        res.status(500).json({ error: 'Erro ao parsear o arquivo JSON' });
        return;
      }
    }

    // Verifica se a categoria e a palavra (key) existem
    if (!gameData[category] || !gameData[category][key]) {
      res.status(404).json({ error: 'Palavra não encontrada para update.' });
      return;
    }

    // Se um novo arquivo de imagem foi enviado, atualiza a imagem
    let newImageFileName = gameData[category][key].img; // mantém o nome atual se não for alterado
    if (files.image) {
      let imageFile = files.image as File | File[];
      if (Array.isArray(imageFile)) {
        imageFile = imageFile[0];
      }
      // Obtém o caminho do arquivo
      const filePath = (imageFile as any).filepath || (imageFile as any).path;
      if (!filePath) {
        res.status(400).json({ error: 'Caminho do arquivo não encontrado para a imagem.' });
        return;
      }
      const imageData = await fs.readFile(filePath);
      const imageBase64 = imageData.toString('base64');

      // Define o caminho da imagem no repositório (por exemplo, na pasta "imgs")
      newImageFileName = imageFile.originalFilename;
      const imagePathRepo = `imgs/${newImageFileName}`;
      const imageUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${imagePathRepo}`;

      // Tenta buscar o arquivo de imagem atual para obter seu sha (se existir)
      let currentImageSha: string | undefined;
      const getImageResponse = await fetch(imageUrl, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
      });
      if (getImageResponse.ok) {
        const imageJson = await getImageResponse.json();
        currentImageSha = imageJson.sha;
      }

      // Envia a imagem (faz o PUT para criar ou atualizar)
      const commitMessageImage = `Atualiza imagem para a palavra ${key}`;
      const bodyImage: any = {
        message: commitMessageImage,
        content: imageBase64
      };
      if (currentImageSha) {
        bodyImage.sha = currentImageSha;
      }
      const updateImageResponse = await fetch(imageUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyImage)
      });
      if (!updateImageResponse.ok) {
        const errorData = await updateImageResponse.json();
        res.status(500).json({ error: 'Erro ao atualizar a imagem no GitHub', details: errorData });
        return;
      }
      // Atualiza os campos de imagem na entrada
      gameData[category][key].img = newImageFileName;
      gameData[category][key].imgUrl = `./${imagePathRepo}`;
    }

    // Normaliza os campos "name" e "desc" para strings
    const normalizedName = Array.isArray(nameField) ? nameField.join('') : nameField;
    const normalizedDesc = Array.isArray(descField) ? descField.join('') : descField;
    gameData[category][key].name = normalizedName;
    gameData[category][key].desc = normalizedDesc;

    // Converte o JSON atualizado para base64
    const updatedContent = JSON.stringify(gameData, null, 2);
    const updatedContentBase64 = Buffer.from(updatedContent).toString('base64');
    const commitMessageJSON = `Atualiza palavra ${key} na categoria ${category}`;

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
        sha: shaJson
      })
    });
    if (!updateJSONResponse.ok) {
      const errorData = await updateJSONResponse.json();
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
