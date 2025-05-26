const express = require('express');
const router = express.Router();
const {
  getTasks,
  getTask,
  createTasks,
  updateTasks,
  deleteTask
} = require('../controllers/taskController');

router
  .route('/')
  .get(getTasks)
  .post(createTasks)
  .put(updateTasks);

router
  .route('/:id')
  .get(getTask)
  .put(updateTasks)
  .delete(deleteTask);

module.exports = router;