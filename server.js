const express = require('express');
const mongoose = require('mongoose'); 
const cors = require('cors');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Conexión a MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('🔴 ERROR CRÍTICO: La variable de entorno MONGO_URI no está definida en Render.');
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('🟢 Conectado exitosamente a MongoDB Atlas'))
        .catch((err) => console.error('🔴 Error conectando a MongoDB:', err));
}

// ==========================================
// SCHEMAS & MODELOS
// ==========================================
const DataStoreSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

const DataStore = mongoose.model('DataStore', DataStoreSchema);

// ==========================================
// RUTAS API REST (RUTAS DIRECTAS)
// ==========================================

// Ruta raíz para verificación simple
app.get('/', (req, res) => {
    res.send('🚀 Luxe API funcionando correctamente');
});

// GET: Obtener datos por clave (/api/propiedades, /api/prospectos, etc.)
app.get('/api/:key', async (req, res) => {
    try {
        const item = await DataStore.findOne({ key: req.params.key });
        if (!item) {
            return res.json([]); // Si no existe la clave, responde array vacío en JSON
        }
        return res.json(item.data);
    } catch (error) {
        return res.status(500).json({ error: 'Error al obtener datos', details: error.message });
    }
});

// POST: Guardar o Actualizar datos
app.post('/api/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const data = req.body;

        const updated = await DataStore.findOneAndUpdate(
            { key: key },
            { key: key, data: data },
            { upsert: true, new: true }
        );

        return res.json({ success: true, key: updated.key });
    } catch (error) {
        return res.status(500).json({ error: 'Error al guardar datos', details: error.message });
    }
});

// DELETE: Borrar datos por clave
app.delete('/api/:key', async (req, res) => {
    try {
        await DataStore.deleteOne({ key: req.params.key });
        return res.json({ success: true, message: `Clave ${req.params.key} eliminada.` });
    } catch (error) {
        return res.status(500).json({ error: 'Error al eliminar', details: error.message });
    }
});

// CAPTURA GLOBAL DE ERRORES PARA RUTAS /api/* (Garantiza respuesta JSON si la ruta falla)
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: true, message: `La ruta ${req.originalUrl} no existe.` });
});

// Arrancar servidor
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
