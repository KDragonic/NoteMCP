const Task = require('../models/Task');

// Получить все задачи
// GET /api/tasks
exports.getTasks = async (req, res) => {
  try {
    const tasks = await Task.findAll();

    res.status(200).json({
      success: true,
      count: tasks.length,
      data: tasks
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Серверная ошибка'
    });
  }
};

// Получить одну задачу
// GET /api/tasks/:id
exports.getTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Задача не найдена'
      });
    }

    res.status(200).json({
      success: true,
      data: task
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Серверная ошибка'
    });
  }
};

// Создать несколько задач
// POST /api/tasks
exports.createTasks = async (req, res) => {
  try {
    if (!Array.isArray(req.body)) {
      return res.status(400).json({
        success: false,
        error: 'Ожидается массив задач'
      });
    }

    // Обработка массива задач
    const tasks = [];
    const errors = [];

    for (const taskData of req.body) {
      try {
        const task = await Task.create(taskData);
        tasks.push(task);
      } catch (createError) {
        errors.push({
          data: taskData,
          error: createError.message
        });
      }
    }

    res.status(201).json({
      success: true,
      count: tasks.length,
      data: tasks,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Серверная ошибка'
    });
  }
};

// Обновить несколько задач
// PUT /api/tasks
exports.updateTasks = async (req, res) => {
  try {
    if (!Array.isArray(req.body)) {
      return res.status(400).json({
        success: false,
        error: 'Ожидается массив задач'
      });
    }

    // Обработка массива задач для обновления
    const tasks = [];
    const errors = [];

    for (const taskData of req.body) {
      // Для каждого элемента массива должен быть указан id
      if (!taskData.id) {
        errors.push({ error: 'Отсутствует ID задачи для обновления', data: taskData });
        continue;
      }

      try {
        const task = await Task.update(taskData.id, taskData, taskData.group_name || 'default');

        if (!task) {
          errors.push({ error: `Задача с ID ${taskData.id} не найдена`, data: taskData });
          continue;
        }

        tasks.push(task);
      } catch (updateError) {
        errors.push({ error: updateError.message, data: taskData });
      }
    }

    res.status(200).json({
      success: true,
      updated: tasks.length,
      failed: errors.length,
      data: tasks,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Серверная ошибка'
    });
  }
};

// Удалить задачу
// DELETE /api/tasks/:id
exports.deleteTask = async (req, res) => {
  try {
    const task = await Task.delete(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Задача не найдена'
      });
    }

    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Серверная ошибка'
    });
  }
};