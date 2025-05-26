const { getDb } = require('../config/db');

class Task {
  static findAll(groupName) {
    if (!groupName) {
      return Promise.reject(new Error('Имя группы должно быть указано'));
    }

    return new Promise((resolve, reject) => {
      const db = getDb();
      db.all('SELECT * FROM tasks WHERE group_name = ? ORDER BY createdAt DESC', [groupName], (err, rows) => {
        db.close();
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  static findById(id, groupName) {
    if (!groupName) {
      return Promise.reject(new Error('Имя группы должно быть указано'));
    }

    return new Promise((resolve, reject) => {
      const db = getDb();
      db.get('SELECT * FROM tasks WHERE id = ? AND group_name = ?', [id, groupName], (err, row) => {
        if (err) {
          db.close();
          reject(err);
          return;
        }

        if (!row) {
          db.close();
          resolve(null);
          return;
        }

        // Получаем связанные задачи
        db.all(
          `SELECT tr.id, tr.relation_type, t.*
           FROM task_relations tr
           JOIN tasks t ON tr.target_task_id = t.id
           WHERE tr.source_task_id = ?`,
          [id],
          (err, relatedTasks) => {
            db.close();
            if (err) {
              reject(err);
              return;
            }

            // Добавляем связанные задачи к результату
            row.relatedTasks = relatedTasks || [];
            resolve(row);
          }
        );
      });
    });
  }

  static create(taskData) {
    return new Promise((resolve, reject) => {
      const db = getDb();
      const {
        title,
        description,
        status = 'ожидает',
        priority = 3,
        group_name,
        relatedTasks = []  // Новый параметр для связанных задач
      } = taskData;

      // Валидация данных
      if (!title) {
        reject(new Error('Пожалуйста, добавьте заголовок задачи'));
        return;
      }

      if (!group_name) {
        reject(new Error('Имя группы должно быть указано'));
        return;
      }

      // Проверка приоритета (должен быть от 1 до 5)
      const priorityNum = parseInt(priority, 10);
      if (isNaN(priorityNum) || priorityNum < 1 || priorityNum > 5) {
        reject(new Error('Приоритет должен быть числом от 1 до 5'));
        return;
      }

      const sql = `INSERT INTO tasks (title, description, status, priority, group_name)
                   VALUES (?, ?, ?, ?, ?)`;

      db.run(sql, [title, description, status, priorityNum, group_name], function(err) {
        if (err) {
          db.close();
          reject(err);
          return;
        }

        const newTaskId = this.lastID;

        // Если есть связанные задачи, создаем связи
        if (relatedTasks && relatedTasks.length > 0) {
          const relationPromises = relatedTasks.map(targetId => {
            return Task.addRelation(newTaskId, targetId, 'связана');
          });

          Promise.all(relationPromises)
            .then(() => {
              // Получаем созданную задачу для возврата
              Task.findById(newTaskId, group_name)
                .then(task => {
                  db.close();
                  resolve(task);
                })
                .catch(err => {
                  db.close();
                  reject(err);
                });
            })
            .catch(err => {
              db.close();
              reject(err);
            });
        } else {
          // Получаем созданную задачу для возврата (если нет связей)
          Task.findById(newTaskId, group_name)
            .then(task => {
              db.close();
              resolve(task);
            })
            .catch(err => {
              db.close();
              reject(err);
            });
        }
      });
    });
  }

  static update(id, taskData, groupName) {
    if (!groupName) {
      return Promise.reject(new Error('Имя группы должно быть указано'));
    }

    return new Promise((resolve, reject) => {
      const db = getDb();
      const { title, description, status, priority, group_name } = taskData;

      // Формируем набор полей для обновления
      const fields = [];
      const values = [];

      if (title !== undefined) {
        fields.push('title = ?');
        values.push(title);
      }

      if (description !== undefined) {
        fields.push('description = ?');
        values.push(description);
      }

      if (status !== undefined) {
        fields.push('status = ?');
        values.push(status);
      }

      if (priority !== undefined) {
        // Проверка приоритета (должен быть от 1 до 5)
        const priorityNum = parseInt(priority, 10);
        if (isNaN(priorityNum) || priorityNum < 1 || priorityNum > 5) {
          reject(new Error('Приоритет должен быть числом от 1 до 5'));
          return;
        }

        fields.push('priority = ?');
        values.push(priorityNum);
      }

      if (group_name !== undefined) {
        fields.push('group_name = ?');
        values.push(group_name);
      }

      // Если нет полей для обновления
      if (fields.length === 0) {
        db.close();
        resolve(null);
        return;
      }

      // Добавляем id и group_name в массив значений для WHERE
      values.push(id);
      values.push(groupName);

      const sql = `UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND group_name = ?`;

      db.run(sql, values, function(err) {
        if (err) {
          db.close();
          reject(err);
          return;
        }

        if (this.changes === 0) {
          db.close();
          resolve(null); // Задача не найдена
          return;
        }

        // Получаем обновленную задачу (используем новую группу, если была изменена)
        Task.findById(id, group_name !== undefined ? group_name : groupName)
          .then(task => {
            db.close();
            resolve(task);
          })
          .catch(err => {
            db.close();
            reject(err);
          });
      });
    });
  }

  static delete(id, groupName) {
    if (!groupName) {
      return Promise.reject(new Error('Имя группы должно быть указано'));
    }

    return new Promise((resolve, reject) => {
      const db = getDb();

      // Сначала получаем задачу, чтобы убедиться, что она существует
      Task.findById(id, groupName)
        .then(task => {
          if (!task) {
            db.close();
            resolve(null);
            return;
          }

          // Удаляем связанные записи из таблицы связей
          db.run('DELETE FROM task_relations WHERE source_task_id = ? OR target_task_id = ?',
            [id, id], function(err) {
            if (err) {
              db.close();
              reject(err);
              return;
            }

            // Удаляем саму задачу
            db.run('DELETE FROM tasks WHERE id = ? AND group_name = ?', [id, groupName], function(err) {
              db.close();
              if (err) {
                reject(err);
                return;
              }
              resolve(task);
            });
          });
        })
        .catch(err => {
          db.close();
          reject(err);
        });
    });
  }

  static addRelation(sourceTaskId, targetTaskId, relationType = 'связана') {
    return new Promise((resolve, reject) => {
      const db = getDb();

      // Сначала проверяем, что обе задачи существуют в базе данных
      db.all(
        `SELECT id, group_name FROM tasks WHERE id IN (?, ?)`,
        [sourceTaskId, targetTaskId],
        (err, tasks) => {
          if (err) {
            db.close();
            reject(err);
            return;
          }

          // Проверяем, что получили оба ID задач
          if (!tasks || tasks.length !== 2) {
            db.close();
            reject(new Error(`Одна или обе задачи не найдены`));
            return;
          }

          // Проверяем, что задачи не являются одной и той же
          if (sourceTaskId === targetTaskId) {
            db.close();
            reject(new Error('Невозможно связать задачу с самой собой'));
            return;
          }

          // Создаем связь
          db.run(
            `INSERT INTO task_relations (source_task_id, target_task_id, relation_type)
             VALUES (?, ?, ?)`,
            [sourceTaskId, targetTaskId, relationType],
            function(err) {
              if (err) {
                // Проверяем, является ли ошибка нарушением уникальности
                if (err.message.includes('UNIQUE constraint failed')) {
                  db.close();
                  reject(new Error('Такая связь уже существует'));
                  return;
                }

                db.close();
                reject(err);
                return;
              }

              // Получаем созданную связь для возврата
              db.get(
                `SELECT tr.*, t.title as target_title, t.status as target_status, t.priority as target_priority
                 FROM task_relations tr
                 JOIN tasks t ON tr.target_task_id = t.id
                 WHERE tr.id = ?`,
                [this.lastID],
                (err, relation) => {
                  db.close();
                  if (err) {
                    reject(err);
                    return;
                  }

                  resolve(relation);
                }
              );
            }
          );
        }
      );
    });
  }

  static removeRelation(relationId) {
    return new Promise((resolve, reject) => {
      const db = getDb();

      // Сначала получаем связь, чтобы вернуть ее в ответе
      db.get(
        `SELECT * FROM task_relations WHERE id = ?`,
        [relationId],
        (err, relation) => {
          if (err) {
            db.close();
            reject(err);
            return;
          }

          if (!relation) {
            db.close();
            resolve(null);
            return;
          }

          // Удаляем связь
          db.run('DELETE FROM task_relations WHERE id = ?', [relationId], function(err) {
            db.close();
            if (err) {
              reject(err);
              return;
            }

            resolve(relation);
          });
        }
      );
    });
  }

  static getRelatedTasks(taskId) {
    return new Promise((resolve, reject) => {
      const db = getDb();

      db.all(
        `SELECT tr.id as relation_id, tr.relation_type, tr.target_task_id, t.*
         FROM task_relations tr
         JOIN tasks t ON tr.target_task_id = t.id
         WHERE tr.source_task_id = ?`,
        [taskId],
        (err, relatedTasks) => {
          db.close();
          if (err) {
            reject(err);
            return;
          }

          resolve(relatedTasks || []);
        }
      );
    });
  }

  static async generateTaskGraph(groupName) {
    if (!groupName) {
      throw new Error('Имя группы должно быть указано');
    }

    const db = getDb();
    try {
      // Получаем все задачи из указанной группы
      const tasks = await this.findAll(groupName);

      if (!tasks || tasks.length === 0) {
        db.close();
        return {
          graph: "graph TD\n    empty((\"Нет задач\"))\n    style empty fill:#f9f,stroke:#333,stroke-width:2px",
          nodesInfo: []
        };
      }

      // Формируем представление графа в формате Mermaid
      let mermaidGraph = "graph TD\n";
      let nodesInfo = [];
      const taskIds = tasks.map(task => task.id);

      // Добавляем узлы (задачи)
      for (const task of tasks) {
        const escapedTitle = task.title.replace(/"/g, '\\"');

        const statusStyle = task.status === 'завершена' ? 'fill:#9f9,stroke:#333' :
                            task.status === 'в процессе' ? 'fill:#9cf,stroke:#333' :
                            'fill:#ff9,stroke:#333';

        const borderStyle = task.priority === 1 ? 'stroke-width:4px' :
                            task.priority === 2 ? 'stroke-width:3px' :
                            task.priority === 3 ? 'stroke-width:2px' :
                            task.priority === 4 ? 'stroke-width:1px' :
                            'stroke-dasharray: 5 5';

        mermaidGraph += `    task${task.id}("${task.id}: ${escapedTitle}")\n`;
        mermaidGraph += `    style task${task.id} ${statusStyle},${borderStyle}\n`;

        nodesInfo.push({
          id: task.id,
          title: task.title,
          description: task.description || '',
          status: task.status,
          priority: task.priority
        });
      }

      // Получаем все связи между задачами
      const relations = await new Promise((resolve, reject) => {
        const placeholders = taskIds.map(() => '?').join(',');
        const query = `
          SELECT * FROM task_relations
          WHERE source_task_id IN (${placeholders})
          AND target_task_id IN (${placeholders})
        `;

        db.all(
          query,
          [...taskIds, ...taskIds],
          (err, rows) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(rows || []);
          }
        );
      });

      // Добавляем связи (ребра)
      for (const relation of relations) {
        const { source_task_id, target_task_id, relation_type } = relation;
        const label = relation_type && relation_type !== 'связана' ? ` |${relation_type}|` : '';

        mermaidGraph += `    task${source_task_id} -->`;
        if (label) mermaidGraph += label;
        mermaidGraph += ` task${target_task_id}\n`;
      }

      // Добавляем легенду
      mermaidGraph += `\n    subgraph "Легенда"\n`;
      mermaidGraph += `        legendWaiting("⬜ Ожидает") --> legendInProgress("🔵 В процессе") --> legendCompleted("🟢 Завершена")\n`;
      mermaidGraph += `        style legendWaiting fill:#ff9,stroke:#333\n`;
      mermaidGraph += `        style legendInProgress fill:#9cf,stroke:#333\n`;
      mermaidGraph += `        style legendCompleted fill:#9f9,stroke:#333\n`;
      mermaidGraph += `        legendP1("Приоритет 1") --> legendP3("Приоритет 3") --> legendP5("Приоритет 5")\n`;
      mermaidGraph += `        style legendP1 stroke-width:4px\n`;
      mermaidGraph += `        style legendP3 stroke-width:2px\n`;
      mermaidGraph += `        style legendP5 stroke-dasharray: 5 5\n`;
      mermaidGraph += `    end\n`;

      db.close();
      return { graph: mermaidGraph, nodesInfo };
    } catch (error) {
      db.close();
      console.error('Ошибка при генерации графа:', error);
      return {
        graph: `graph TD\n    error("Ошибка: ${error.message}")\n    style error fill:#f99,stroke:#333,stroke-width:2px`,
        nodesInfo: []
      };
    }
  }
}

module.exports = Task;