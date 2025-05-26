const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const Task = require('./models/Task');
const { initDb, getRootFolderName } = require('./config/db');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const open = require('open').default || require('open');
const os = require('os');

// Получаем имя корневой папки проекта для использования в группах задач
const PROJECT_ROOT_FOLDER = getRootFolderName();
console.log(`Проектная папка: ${PROJECT_ROOT_FOLDER}`);

// Функция для преобразования имени группы с учетом папки проекта
function processGroupName(groupName) {
  if (!groupName) {
    throw new Error('Имя группы должно быть указано');
  }

  // Формат группы: имя_папки:имя_группы - обеспечивает уникальность
  return `${PROJECT_ROOT_FOLDER}:${groupName}`;
}

/**
 * Генерирует локальную диаграмму Mermaid в указанном формате и открывает её в браузере
 * @param {string} mermaidDefinition - Содержимое Mermaid-диаграммы
 * @param {string} format - Формат генерации: 'svg', 'png', 'pdf'
 * @param {string} groupName - Имя группы задач для названия файла
 * @returns {Promise<{filePath: string, content: string}>} - Путь к сгенерированному файлу и его содержимое
 */
async function generateLocalDiagram(mermaidDefinition, format = 'svg', groupName) {
  if (!groupName) {
    throw new Error('Имя группы должно быть указано');
  }

  groupName = groupName.replace(":", "_").replace(" ", "_").replace(".", "_").replace("\\", "_").replace("/", "_");

  // Создаем временную директорию, если её нет
  const outputDir = path.join(os.tmpdir(), 'task-manager-mcp');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Создаем временный Mermaid файл
  const timestamp = new Date().getTime();
  const mermaidFile = path.join(outputDir, `diagram_${groupName}.mmd`);
  fs.writeFileSync(mermaidFile, mermaidDefinition);

  // Определяем выходной файл
  const outputFile = path.join(outputDir, `diagram_${groupName}.${format}`);

  return new Promise((resolve, reject) => {
    // Путь к mmdc исполняемому файлу в node_modules
    const mmdcPath = path.join(__dirname, 'node_modules', '.bin', 'mmdc');

    // Команда для генерации диаграммы
    const command = `"${mmdcPath}" -i "${mermaidFile}" -o "${outputFile}" -b transparent`;

    exec(command, async (error, stdout, stderr) => {
      if (error) {
        console.error(`Ошибка генерации диаграммы: ${error.message}`);
        console.error(`stderr: ${stderr}`);
        reject(error);
        return;
      }

      console.log(`Диаграмма сгенерирована: ${outputFile}`);

      try {
        // Открываем файл в браузере по умолчанию
        // Используем команду в зависимости от ОС вместо пакета open
        const openCommand = process.platform === 'win32'
          ? `start "" "${outputFile}"`
          : process.platform === 'darwin'
            ? `open "${outputFile}"`
            : `xdg-open "${outputFile}"`;

        exec(openCommand, (openError) => {
          if (openError) {
            console.error(`Предупреждение: Не удалось автоматически открыть файл: ${openError.message}`);
            // Продолжаем выполнение даже при ошибке открытия
          }

          // Преобразуем файл в base64 если нужно вернуть содержимое
          let content = '';
          if (format === 'svg') {
            content = fs.readFileSync(outputFile, 'utf-8');
          }

          resolve({ filePath: outputFile, content });
        });
      } catch (openError) {
        console.error(`Ошибка при открытии файла: ${openError.message}`);
        // Возвращаем хотя бы путь к файлу даже если не удалось открыть
        resolve({ filePath: outputFile, content: '' });
      }
    });
  });
}

async function startServer() {
  try {
    // Инициализируем базу данных
    await initDb();

    // Создаем сервер MCP
    const server = new McpServer({
      name: "task-manager-mcp",
      version: "1.0.0"
    });

    // Получить все задачи
    server.tool(
      "getTasks",
      {
        group_name: z.string().describe("Название группы задач")
      },
      async ({ group_name }) => {
        try {
          const processedGroupName = processGroupName(group_name);
          const tasks = await Task.findAll(processedGroupName);

          return {
            content: [{
              type: "text",
              text: `Задачи из группы "${group_name}" (${processedGroupName}):\n${JSON.stringify(tasks, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при получении задач: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Все задачи",
            description: "Получить все задачи из указанной группы",
            parameters: { group_name: "NoteMCP" }
          },
          {
            name: "Задачи проекта",
            description: "Получить все задачи указанного проекта",
            parameters: { group_name: "project1" }
          }
        ]
      }
    );

    // Получить задачу по ID
    server.tool(
      "getTask",
      {
        id: z.number().int().positive().describe("ID задачи для получения"),
        group_name: z.string().describe("Название группы задач")
      },
      async ({ id, group_name }) => {
        try {
          const processedGroupName = processGroupName(group_name);
          const task = await Task.findById(id, processedGroupName);
          if (!task) {
            return {
              content: [{ type: "text", text: `Задача с ID ${id} не найдена в группе "${group_name}" (${processedGroupName})` }],
              isError: true
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(task, null, 2) }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при получении задачи: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Получить задачу по ID",
            description: "Получить детали задачи с ID 1",
            parameters: { id: 1, group_name: "NoteMCP" }
          },
          {
            name: "Задача из проекта",
            description: "Получить задачу с ID 2 из группы project1",
            parameters: { id: 2, group_name: "project1" }
          }
        ]
      }
    );

    // Создать новую задачу
    server.tool(
      "createTask",
      {
        title: z.string().min(1).describe("Заголовок задачи"),
        description: z.string().optional().describe("Описание задачи"),
        status: z.enum(["ожидает", "в процессе", "завершена"]).optional().describe("Статус задачи"),
        priority: z.coerce.number().int().min(1).max(5).optional().describe("Приоритет задачи от 1 до 5 (1 - высший, 5 - низший)"),
        group_name: z.string().describe("Название группы задач"),
        relatedTasks: z.array(z.number().int().positive()).optional().describe("Массив ID связанных задач")
      },
      async (data) => {
        try {
          // Обрабатываем имя группы
          data.group_name = processGroupName(data.group_name);

          const task = await Task.create(data);
          return {
            content: [{
              type: "text",
              text: `Задача успешно создана в группе "${data.group_name}":\n${JSON.stringify(task, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при создании задачи: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Простая задача",
            description: "Создать простую задачу с минимальными параметрами",
            parameters: { title: "Новая задача", group_name: "NoteMCP" }
          },
          {
            name: "Полная задача с приоритетом",
            description: "Создать задачу со всеми параметрами",
            parameters: {
              title: "Важная задача",
              description: "Детальное описание задачи",
              status: "в процессе",
              priority: 1,
              group_name: "project1"
            }
          },
          {
            name: "Задача со связями",
            description: "Создать задачу и связать ее с существующими задачами",
            parameters: {
              title: "Связанная задача",
              description: "Задача, связанная с другими",
              priority: 2,
              relatedTasks: [1, 2],
              group_name: "project2"
            }
          }
        ]
      }
    );

    // Создать множество задач
    server.tool(
      "createTasks",
      {
        tasks: z.array(z.object({
          title: z.string().min(1).describe("Заголовок задачи"),
          description: z.string().optional().describe("Описание задачи"),
          status: z.enum(["ожидает", "в процессе", "завершена"]).optional().describe("Статус задачи"),
          priority: z.coerce.number().int().min(1).max(5).optional().describe("Приоритет задачи от 1 до 5 (1 - высший, 5 - низший)"),
          group_name: z.string().describe("Название группы задач"),
          relatedTasks: z.array(z.number().int().positive()).optional().describe("Массив ID связанных задач")
        })).describe("Массив задач для создания")
      },
      async ({ tasks }) => {
        try {
          const createdTasks = [];
          const errors = [];

          for (const taskData of tasks) {
            try {
              // Обрабатываем имя группы для каждой задачи
              taskData.group_name = processGroupName(taskData.group_name);

              const task = await Task.create(taskData);
              createdTasks.push(task);
            } catch (error) {
              errors.push({
                data: taskData,
                error: error.message
              });
            }
          }

          return {
            content: [{
              type: "text",
              text: `Создано задач: ${createdTasks.length}\nОшибок: ${errors.length}\n\n${JSON.stringify({
                created: createdTasks,
                errors: errors.length > 0 ? errors : undefined
              }, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при создании задач: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Создать несколько задач",
            description: "Создать несколько задач одним запросом",
            parameters: {
              tasks: [
                { title: "Задача 1", priority: 1, group_name: "NoteMCP" },
                { title: "Задача 2", priority: 2, group_name: "project1" },
                { title: "Задача 3", status: "в процессе", group_name: "project2" }
              ]
            }
          }
        ]
      }
    );

    // Обновить задачи
    server.tool(
      "updateTasks",
      {
        tasks: z.array(z.object({
          id: z.number().int().positive().describe("ID задачи для обновления"),
          title: z.string().optional().describe("Заголовок задачи"),
          description: z.string().optional().describe("Описание задачи"),
          status: z.enum(["ожидает", "в процессе", "завершена"]).optional().describe("Статус задачи"),
          priority: z.coerce.number().int().min(1).max(5).optional().describe("Приоритет задачи от 1 до 5 (1 - высший, 5 - низший)"),
          group_name: z.string().describe("Название группы задач")
        })).describe("Массив задач для обновления")
      },
      async ({ tasks }) => {
        try {
          const updatedTasks = [];
          const errors = [];

          for (const taskData of tasks) {
            try {
              if (!taskData.id) {
                errors.push({
                  data: taskData,
                  error: 'Отсутствует ID задачи для обновления'
                });
                continue;
              }

              // Обрабатываем имя группы
              const groupName = processGroupName(taskData.group_name);

              const task = await Task.update(taskData.id, taskData, groupName);

              if (!task) {
                errors.push({
                  data: taskData,
                  error: `Задача с ID ${taskData.id} не найдена в группе "${groupName}"`
                });
                continue;
              }

              updatedTasks.push(task);
            } catch (error) {
              errors.push({
                data: taskData,
                error: error.message
              });
            }
          }

          return {
            content: [{
              type: "text",
              text: `Обновлено задач: ${updatedTasks.length}\nОшибок: ${errors.length}\n\n${JSON.stringify({
                updated: updatedTasks,
                errors: errors.length > 0 ? errors : undefined
              }, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при обновлении задач: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Обновить несколько задач",
            description: "Обновить несколько задач одним запросом",
            parameters: {
              tasks: [
                { id: 1, status: "завершена", group_name: "NoteMCP" },
                { id: 2, priority: 1, group_name: "project1" },
                { id: 3, title: "Обновленная задача", description: "Новое описание", group_name: "project2" }
              ]
            }
          }
        ]
      }
    );

    // Удалить задачу
    server.tool(
      "deleteTask",
      {
        id: z.number().int().positive().describe("ID задачи для удаления"),
        group_name: z.string().describe("Название группы задач")
      },
      async ({ id, group_name }) => {
        try {
          const processedGroupName = processGroupName(group_name);
          const task = await Task.delete(id, processedGroupName);

          if (!task) {
            return {
              content: [{ type: "text", text: `Задача с ID ${id} не найдена в группе "${group_name}" (${processedGroupName})` }],
              isError: true
            };
          }

          return {
            content: [{ type: "text", text: `Задача с ID ${id} успешно удалена из группы "${group_name}" (${processedGroupName})` }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при удалении задачи: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Удалить задачу",
            description: "Удалить задачу с указанным ID",
            parameters: { id: 1, group_name: "NoteMCP" }
          },
          {
            name: "Удалить из проекта",
            description: "Удалить задачу из конкретной группы",
            parameters: { id: 2, group_name: "project1" }
          }
        ]
      }
    );

    // Добавить связи между задачами (множественный вариант)
    server.tool(
      "addTaskRelations",
      {
        relations: z.array(z.object({
          sourceTaskId: z.number().int().positive().describe("ID исходной задачи"),
          targetTaskId: z.number().int().positive().describe("ID целевой задачи"),
          relationType: z.string().optional().describe("Тип связи между задачами"),
          group_name: z.string().describe("Название группы задач")
        })).describe("Массив связей для создания")
      },
      async ({ relations }) => {
        try {
          const results = [];
          const errors = [];

          for (const relation of relations) {
            try {
              // Обрабатываем имя группы
              const processedGroupName = processGroupName(relation.group_name);
              const relationType = relation.relationType || 'связана';

              // Проверяем, что обе задачи принадлежат указанной группе
              const sourceTask = await Task.findById(relation.sourceTaskId, processedGroupName);
              if (!sourceTask) {
                errors.push(`Исходная задача с ID ${relation.sourceTaskId} не найдена в группе "${relation.group_name}" (${processedGroupName})`);
                continue;
              }

              const targetTask = await Task.findById(relation.targetTaskId, processedGroupName);
              if (!targetTask) {
                errors.push(`Целевая задача с ID ${relation.targetTaskId} не найдена в группе "${relation.group_name}" (${processedGroupName})`);
                continue;
              }

              await Task.addRelation(relation.sourceTaskId, relation.targetTaskId, relationType);
              results.push(`${relation.sourceTaskId} ---[${relationType}]---> ${relation.targetTaskId} в группе "${relation.group_name}"`);
            } catch (error) {
              errors.push(`Ошибка при создании связи ${relation.sourceTaskId} -> ${relation.targetTaskId}: ${error.message}`);
            }
          }

          return {
            content: [{
              type: "text",
              text: `Результаты создания связей:\n
Успешно создано: ${results.length}
${results.length > 0 ? '- ' + results.join('\n- ') : ''}\n
${errors.length > 0 ? `Ошибки (${errors.length}):\n- ${errors.join('\n- ')}` : ''}
`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при создании связей между задачами: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Создать несколько связей",
            description: "Создать несколько связей между задачами одним запросом",
            parameters: {
              relations: [
                { sourceTaskId: 1, targetTaskId: 2, group_name: "project1" },
                { sourceTaskId: 2, targetTaskId: 3, relationType: "зависит от", group_name: "project1" }
              ]
            }
          }
        ]
      }
    );

    // Заменяем метод удаления связи на метод удаления нескольких связей
    server.tool(
      "removeTaskRelations",
      {
        relationIds: z.array(z.number().int().positive()).describe("Массив ID связей для удаления")
      },
      async ({ relationIds }) => {
        try {
          const results = [];
          const errors = [];

          for (const relationId of relationIds) {
            try {
              const relation = await Task.removeRelation(relationId);

              if (!relation) {
                errors.push(`Связь с ID ${relationId} не найдена`);
                continue;
              }

              results.push(`Связь с ID ${relationId} успешно удалена`);
            } catch (error) {
              errors.push(`Ошибка при удалении связи с ID ${relationId}: ${error.message}`);
            }
          }

          return {
            content: [{
              type: "text",
              text: `Результаты удаления связей:\n
Успешно удалено: ${results.length}
${results.length > 0 ? '- ' + results.join('\n- ') : ''}\n
${errors.length > 0 ? `Ошибки (${errors.length}):\n- ${errors.join('\n- ')}` : ''}
`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при удалении связей: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Удалить несколько связей",
            description: "Удалить несколько связей по их ID",
            parameters: { relationIds: [1, 2, 3] }
          }
        ]
      }
    );

    // Оставляем версию для единичной связи для обратной совместимости
    server.tool(
      "removeTaskRelation",
      {
        relationId: z.number().int().positive().describe("ID связи для удаления")
      },
      async ({ relationId }) => {
        try {
          const relation = await Task.removeRelation(relationId);

          if (!relation) {
            return {
              content: [{ type: "text", text: `Связь с ID ${relationId} не найдена` }],
              isError: true
            };
          }

          return {
            content: [{ type: "text", text: `Связь с ID ${relationId} успешно удалена` }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при удалении связи: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Удалить связь",
            description: "Удалить связь по её ID",
            parameters: { relationId: 1 }
          }
        ]
      }
    );

    // Добавляем версию для единичной связи для обратной совместимости
    server.tool(
      "addTaskRelation",
      {
        sourceTaskId: z.number().int().positive().describe("ID исходной задачи"),
        targetTaskId: z.number().int().positive().describe("ID целевой задачи"),
        relationType: z.string().optional().describe("Тип связи между задачами"),
        group_name: z.string().describe("Название группы задач")
      },
      async ({ sourceTaskId, targetTaskId, relationType = 'связана', group_name }) => {
        try {
          // Обрабатываем имя группы
          const processedGroupName = processGroupName(group_name);

          // Проверяем, что обе задачи принадлежат указанной группе
          const sourceTask = await Task.findById(sourceTaskId, processedGroupName);
          if (!sourceTask) {
            return {
              content: [{ type: "text", text: `Исходная задача с ID ${sourceTaskId} не найдена в группе "${group_name}" (${processedGroupName})` }],
              isError: true
            };
          }

          const targetTask = await Task.findById(targetTaskId, processedGroupName);
          if (!targetTask) {
            return {
              content: [{ type: "text", text: `Целевая задача с ID ${targetTaskId} не найдена в группе "${group_name}" (${processedGroupName})` }],
              isError: true
            };
          }

          const relation = await Task.addRelation(sourceTaskId, targetTaskId, relationType);

          return {
            content: [{
              type: "text",
              text: `Связь между задачами успешно создана в группе "${group_name}" (${processedGroupName}): ${sourceTaskId} ---[${relationType}]---> ${targetTaskId}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при создании связи между задачами: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Связать задачи",
            description: "Создать связь между двумя задачами",
            parameters: { sourceTaskId: 1, targetTaskId: 2, group_name: "project1" }
          },
          {
            name: "Задачи с типом связи",
            description: "Связать задачи с указанием типа связи",
            parameters: {
              sourceTaskId: 1,
              targetTaskId: 3,
              relationType: "зависит от",
              group_name: "project1"
            }
          }
        ]
      }
    );

    // Получить связанные задачи
    server.tool(
      "getRelatedTasks",
      {
        taskId: z.number().int().positive().describe("ID задачи для получения связанных задач"),
        group_name: z.string().describe("Название группы задач")
      },
      async ({ taskId, group_name }) => {
        try {
          const processedGroupName = processGroupName(group_name);

          // Проверяем существование задачи
          const task = await Task.findById(taskId, processedGroupName);
          if (!task) {
            return {
              content: [{ type: "text", text: `Задача с ID ${taskId} не найдена в группе "${group_name}" (${processedGroupName})` }],
              isError: true
            };
          }

          const relatedTasks = await Task.getRelatedTasks(taskId);

          return {
            content: [{
              type: "text",
              text: `Связанные задачи для задачи ID ${taskId} в группе "${group_name}" (${processedGroupName}):\n${JSON.stringify(relatedTasks, null, 2)}`
            }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при получении связанных задач: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Связанные задачи",
            description: "Получить все задачи, связанные с указанной задачей",
            parameters: { taskId: 1, group_name: "NoteMCP" }
          },
          {
            name: "Связи в проекте",
            description: "Получить связанные задачи для задачи из указанной группы",
            parameters: { taskId: 2, group_name: "project1" }
          }
        ]
      }
    );

    // Визуализация задач в виде графа
    server.tool(
      "getTasksGraph",
      {
        group_name: z.string().describe("Название группы задач"),
        format: z.enum(["text", "svg", "png", "pdf", "local"]).optional().describe("Формат вывода: text=текстовое представление, local/svg/png/pdf=локальные файлы")
      },
      async ({ group_name, format = 'text' }) => {
        try {
          const processedGroupName = processGroupName(group_name);
          const { graph, nodesInfo } = await Task.generateTaskGraph(processedGroupName);

          // Добавление информации о количестве задач и связей
          const tasksCount = nodesInfo.length;
          const edgesCount = (graph.match(/-->/g) || []).length - 2; // Вычитаем 2 стрелки из легенды

          const statsText = `### Граф задач для группы "${group_name}" (${processedGroupName})\n\n` +
            `**Всего задач**: ${tasksCount}\n` +
            `**Связей между задачами**: ${edgesCount > 0 ? edgesCount : 0}\n\n`;

          // Локальная генерация файла (svg, png или pdf)
          if (['svg', 'png', 'pdf', 'local'].includes(format)) {
            const actualFormat = format === 'local' ? 'svg' : format; // По умолчанию SVG
            try {
              const result = await generateLocalDiagram(graph, actualFormat, processedGroupName);

              return {
                content: [
                  {
                    type: "text",
                    text: `Диаграмма для группы "${group_name}" (${processedGroupName}) сгенерирована локально и открыта в браузере.\nПуть к файлу: ${result.filePath}`
                  }
                ]
              };
            } catch (localError) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Ошибка генерации локальной диаграммы: ${localError.message}`
                  },
                  {
                    type: "text",
                    text: "```mermaid\n" + graph + "\n```"
                  }
                ],
                isError: true
              };
            }
          } else if (format !== 'text') {
            // Если указан неизвестный формат, возвращаем сообщение об ошибке
            return {
              content: [
                {
                  type: "text",
                  text: `Неизвестный формат "${format}". Поддерживаемые форматы: text, local, svg, png, pdf.`
                }
              ],
              isError: true
            };
          } else {
            const mermaidText = "```mermaid\n" + graph + "\n```\n\n" +
              "*Подсказка: Зеленым отмечены завершенные задачи, синим - в процессе, желтым - ожидающие. Толщина границы отражает приоритет задачи.*";
            return {
              content: [
                {
                  type: "text",
                  text: statsText + mermaidText
                }
              ]
            };
          }
        } catch (error) {
          console.error("Ошибка при генерации графа:", error);
          return {
            content: [{
              type: "text",
              text: `Ошибка при генерации графа задач: ${error.message}\n\n${error.stack || ""}`
            }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Граф задач по умолчанию",
            description: "Получить граф задач из группы в текстовом виде",
            parameters: { group_name: "NoteMCP" }
          },
          {
            name: "Граф задач проекта",
            description: "Получить граф задач указанного проекта в текстовом виде",
            parameters: { group_name: "project1" }
          },
          {
            name: "Локальный граф как SVG",
            description: "Получить граф задач в виде локального SVG-файла",
            parameters: { group_name: "project1", format: "svg" }
          },
          {
            name: "Локальный граф как PNG",
            description: "Получить граф задач в виде локального PNG-файла",
            parameters: { group_name: "project1", format: "png" }
          },
          {
            name: "Локальный граф как PDF",
            description: "Получить граф задач в виде локального PDF-файла",
            parameters: { group_name: "project1", format: "pdf" }
          },
          {
            name: "Граф задач как локальное изображение",
            description: "Получить граф задач в виде локального файла SVG",
            parameters: { group_name: "project1", format: "local" }
          }
        ]
      }
    );

    // Вставка задачи между двумя другими задачами с созданием связей
    server.tool(
      "insertTaskBetween",
      {
        sourceTaskId: z.number().int().positive().describe("ID исходной задачи"),
        targetTaskId: z.number().int().positive().describe("ID целевой задачи"),
        newTask: z.object({
          title: z.string().min(1).describe("Заголовок новой задачи"),
          description: z.string().optional().describe("Описание новой задачи"),
          status: z.enum(["ожидает", "в процессе", "завершена"]).optional().describe("Статус задачи"),
          priority: z.coerce.number().int().min(1).max(5).optional().describe("Приоритет задачи от 1 до 5 (1 - высший, 5 - низший)")
        }).describe("Данные новой задачи"),
        group_name: z.string().describe("Название группы задач"),
        sourceRelationType: z.string().optional().describe("Тип связи между исходной задачей и новой"),
        targetRelationType: z.string().optional().describe("Тип связи между новой задачей и целевой"),
        removeExistingConnection: z.boolean().optional().describe("Удалить существующую связь между исходной и целевой задачами")
      },
      async ({ sourceTaskId, targetTaskId, newTask, group_name, sourceRelationType = "связана", targetRelationType = "связана", removeExistingConnection = true }) => {
        try {
          // Обрабатываем имя группы
          const processedGroupName = processGroupName(group_name);

          // Проверяем существование задач
          const sourceTask = await Task.findById(sourceTaskId, processedGroupName);
          if (!sourceTask) {
            return {
              content: [{ type: "text", text: `Исходная задача с ID ${sourceTaskId} не найдена в группе "${group_name}" (${processedGroupName})` }],
              isError: true
            };
          }

          const targetTask = await Task.findById(targetTaskId, processedGroupName);
          if (!targetTask) {
            return {
              content: [{ type: "text", text: `Целевая задача с ID ${targetTaskId} не найдена в группе "${group_name}" (${processedGroupName})` }],
              isError: true
            };
          }

          // Проверяем и удаляем существующую связь между исходной и целевой задачами
          let removedConnection = null;
          if (removeExistingConnection) {
            // Получаем связанные задачи для исходной задачи
            const sourceRelations = await Task.getRelatedTasks(sourceTaskId);

            // Ищем прямую связь с целевой задачей
            if (sourceRelations && Array.isArray(sourceRelations)) {
              for (const relation of sourceRelations) {
                if (relation.id === targetTaskId) {
                  // Нашли прямую связь, удаляем ее
                  // Связь хранится с уникальным ID в свойстве relation_id
                  if (relation.relation_id) {
                    removedConnection = await Task.removeRelation(relation.relation_id);
                    break;
                  }
                }
              }
            }
          }

          // Добавляем группу к новой задаче
          newTask.group_name = processedGroupName;

          // Создаем новую задачу
          const createdTask = await Task.create(newTask);

          if (!createdTask) {
            return {
              content: [{ type: "text", text: `Не удалось создать новую задачу` }],
              isError: true
            };
          }

          // Создаем связи между задачами
          const sourceRelation = await Task.addRelation(sourceTaskId, createdTask.id, sourceRelationType);
          const targetRelation = await Task.addRelation(createdTask.id, targetTaskId, targetRelationType);

          const result = {
            content: [{
              type: "text",
              text: `Задача "${createdTask.title}" (ID: ${createdTask.id}) успешно создана между задачами ${sourceTaskId} и ${targetTaskId} в группе "${group_name}".\n\n` +
                    `Созданы связи:\n` +
                    `- ${sourceTaskId} ---[${sourceRelationType}]---> ${createdTask.id}\n` +
                    `- ${createdTask.id} ---[${targetRelationType}]---> ${targetTaskId}`
            }]
          };

          // Если удалили связь, добавляем информацию об этом
          if (removedConnection) {
            result.content[0].text += `\n\nУдалена существующая прямая связь между задачами ${sourceTaskId} и ${targetTaskId}.`;
          }

          return result;
        } catch (error) {
          return {
            content: [{ type: "text", text: `Ошибка при вставке задачи между двумя задачами: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        examples: [
          {
            name: "Вставить задачу между двумя задачами",
            description: "Создать новую задачу и вставить ее между двумя существующими задачами с созданием связей",
            parameters: {
              sourceTaskId: 1,
              targetTaskId: 3,
              newTask: {
                title: "Промежуточная задача",
                description: "Задача, которая должна быть выполнена между двумя другими",
                status: "ожидает",
                priority: 2
              },
              group_name: "project1",
              sourceRelationType: "предшествует",
              targetRelationType: "следует за"
            }
          },
          {
            name: "Вставить простую задачу",
            description: "Вставить задачу между двумя другими с минимальными параметрами",
            parameters: {
              sourceTaskId: 5,
              targetTaskId: 8,
              newTask: {
                title: "Промежуточный шаг"
              },
              group_name: "NoteMCP"
            }
          },
          {
            name: "Вставить задачу без удаления существующей связи",
            description: "Вставить задачу между двумя другими, сохранив существующую прямую связь",
            parameters: {
              sourceTaskId: 10,
              targetTaskId: 11,
              newTask: {
                title: "Дополнительная задача"
              },
              group_name: "project3",
              removeExistingConnection: false
            }
          }
        ]
      }
    );

    // Создать транспорт и запустить сервер
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("MCP сервер запущен и слушает на stdio");
  } catch (error) {
    console.error(`Ошибка запуска MCP сервера: ${error.message}`);
    process.exit(1);
  }
}

startServer();