"use client";

import React, { useState } from 'react';
import { Send, Calendar, Users, MapPin, Plane, DollarSign, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/sitio/ui/button';
import { useToast } from '@/components/sitio/ui/use-toast';

const QuoteForm = () => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    departureCity: '',
    destination: '',
    dateType: 'specific', // specific | flexible
    departureDate: '',
    returnDate: '',
    flexibleDate: '',
    adults: 1,
    children: 0,
    childrenAges: [],
    tripType: '',
    budget: '',
    services: [],
    comments: ''
  });

  const tripTypes = [
    { id: 'playa', label: 'Playa & Relax' },
    { id: 'familiar', label: 'Plan Familiar' },
    { id: 'pareja', label: 'Luna de Miel / Pareja' },
    { id: 'amigos', label: 'Grupo de Amigos' },
    { id: 'celebracion', label: 'Celebración Especial' },
    { id: 'cultural', label: 'Cultural / Exótico' }
  ];

  const budgetRanges = [
    'Menos de $2.000.000 COP',
    '$2.000.000 - $4.000.000 COP',
    '$4.000.000 - $6.000.000 COP',
    '$6.000.000 - $10.000.000 COP',
    'Más de $10.000.000 COP',
    'Presupuesto Flexible'
  ];

  const servicesList = [
    'Tiquetes Aéreos',
    'Alojamiento / Hotel',
    'Plan Todo Incluido',
    'Tours y Actividades',
    'Asistencia Médica',
    'Crucero',
    'Alquiler de Auto',
    'Traslados Aeropuerto'
  ];

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleServiceToggle = (service) => {
    setFormData(prev => {
      const currentServices = prev.services;
      if (currentServices.includes(service)) {
        return { ...prev, services: currentServices.filter(s => s !== service) };
      } else {
        return { ...prev, services: [...currentServices, service] };
      }
    });
  };

  const handleChildrenChange = (e) => {
    const count = parseInt(e.target.value) || 0;
    // Resize ages array to match count, preserving existing values where possible
    const newAges = [...formData.childrenAges].slice(0, count);
    while (newAges.length < count) {
      newAges.push('');
    }
    setFormData(prev => ({
      ...prev,
      children: count,
      childrenAges: newAges
    }));
  };

  const handleAgeChange = (index, value) => {
    const newAges = [...formData.childrenAges];
    newAges[index] = value;
    setFormData(prev => ({ ...prev, childrenAges: newAges }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulate API call
    setTimeout(() => {
      setIsSubmitting(false);
      toast({
        title: "¡Solicitud Enviada con Éxito!",
        description: "Un asesor de D'Spacios Travel te contactará pronto con tu cotización.",
        duration: 5000,
        className: "bg-[#120573] text-white border-none"
      });
      // Optional: Reset form here
    }, 1500);
  };

  return (
    <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">
      <div className="bg-[#120573] py-8 px-6 md:px-10 text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">Diseña tu Viaje Ideal</h2>
        <p className="text-blue-100">Completa el formulario y déjanos hacer realidad tus sueños</p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 md:p-10 space-y-8">

        {/* Section 1: Personal Info */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-[#120573] flex items-center gap-2 border-b border-gray-100 pb-2">
            <Users className="w-5 h-5 text-[#d8f511]" /> Datos de Contacto
          </h3>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Nombre Completo *</label>
              <input
                required
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleInputChange}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50"
                placeholder="Ej. Juan Pérez"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Correo Electrónico *</label>
              <input
                required
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50"
                placeholder="Ej. juan@email.com"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Teléfono / WhatsApp *</label>
              <input
                required
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50"
                placeholder="Ej. +57 300 123 4567"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Ciudad de Salida</label>
              <input
                type="text"
                name="departureCity"
                value={formData.departureCity}
                onChange={handleInputChange}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50"
                placeholder="Ej. Bogotá"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Trip Details */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-[#120573] flex items-center gap-2 border-b border-gray-100 pb-2">
            <Plane className="w-5 h-5 text-[#d8f511]" /> Detalles del Viaje
          </h3>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Destino de Interés *</label>
            <input
              required
              type="text"
              name="destination"
              value={formData.destination}
              onChange={handleInputChange}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50"
              placeholder="Ej. Punta Cana, Europa, Eje Cafetero..."
            />
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Tipo de Fechas</label>
              <div className="flex bg-gray-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, dateType: 'specific' }))}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${formData.dateType === 'specific' ? 'bg-white shadow-sm text-[#120573]' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Fechas Exactas
                </button>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, dateType: 'flexible' }))}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${formData.dateType === 'flexible' ? 'bg-white shadow-sm text-[#120573]' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Fechas Flexibles
                </button>
              </div>
            </div>

            {formData.dateType === 'specific' ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Ida</label>
                  <input
                    type="date"
                    name="departureDate"
                    value={formData.departureDate}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none bg-gray-50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Regreso</label>
                  <input
                    type="date"
                    name="returnDate"
                    value={formData.returnDate}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none bg-gray-50"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Preferencia de Fechas</label>
                <input
                  type="text"
                  name="flexibleDate"
                  value={formData.flexibleDate}
                  onChange={handleInputChange}
                  placeholder="Ej. Primera semana de Diciembre"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none bg-gray-50"
                />
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Travelers */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-[#120573] flex items-center gap-2 border-b border-gray-100 pb-2">
            <Users className="w-5 h-5 text-[#d8f511]" /> Viajeros
          </h3>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Adultos (12+ años)</label>
              <input
                type="number"
                min="1"
                name="adults"
                value={formData.adults}
                onChange={handleInputChange}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Niños (0-11 años)</label>
              <input
                type="number"
                min="0"
                name="children"
                value={formData.children}
                onChange={handleChildrenChange}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50"
              />
            </div>
          </div>

          {formData.children > 0 && (
            <div className="bg-blue-50 p-4 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-4">
              <label className="text-sm font-medium text-[#120573]">Edades de los niños:</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {formData.childrenAges.map((age, index) => (
                  <input
                    key={index}
                    type="number"
                    min="0"
                    max="11"
                    placeholder={`Niño ${index + 1}`}
                    value={age}
                    onChange={(e) => handleAgeChange(index, e.target.value)}
                    className="px-3 py-2 rounded-lg border border-blue-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none text-center"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Section 4: Preferences */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-[#120573] flex items-center gap-2 border-b border-gray-100 pb-2">
            <DollarSign className="w-5 h-5 text-[#d8f511]" /> Preferencias y Presupuesto
          </h3>

          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700">Tipo de Viaje</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {tripTypes.map((type) => (
                <div
                  key={type.id}
                  onClick={() => setFormData(prev => ({ ...prev, tripType: type.id }))}
                  className={`cursor-pointer border rounded-xl p-3 text-center transition-all ${
                    formData.tripType === type.id
                      ? 'bg-[#120573] text-white border-[#120573] shadow-md'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-[#120573]'
                  }`}
                >
                  <span className="text-sm font-medium">{type.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Presupuesto Aprox. por Persona</label>
            <select
              name="budget"
              value={formData.budget}
              onChange={handleInputChange}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50"
            >
              <option value="">Selecciona un rango...</option>
              {budgetRanges.map((range, idx) => (
                <option key={idx} value={range}>{range}</option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700">Servicios a Incluir</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {servicesList.map((service, idx) => (
                <label key={idx} className="flex items-center space-x-3 p-3 border border-gray-100 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
                  <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${formData.services.includes(service) ? 'bg-[#d8f511] border-[#d8f511]' : 'border-gray-300'}`}>
                    {formData.services.includes(service) && <CheckCircle2 className="w-4 h-4 text-[#120573]" />}
                  </div>
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={formData.services.includes(service)}
                    onChange={() => handleServiceToggle(service)}
                  />
                  <span className="text-gray-700 text-sm">{service}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Comentarios Adicionales</label>
            <textarea
              name="comments"
              value={formData.comments}
              onChange={handleInputChange}
              rows="4"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#120573] focus:border-transparent outline-none transition-all bg-gray-50"
              placeholder="¿Algo más que debamos saber? (Alergias, necesidades especiales, celebraciones...)"
            ></textarea>
          </div>
        </div>

        <div className="pt-4">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[#d8f511] hover:bg-[#cbe610] text-[#120573] font-bold text-lg py-6 rounded-xl shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-1"
          >
            {isSubmitting ? 'Enviando Solicitud...' : 'Cotizar mi viaje ahora'}
            {!isSubmitting && <Send className="ml-2 w-5 h-5" />}
          </Button>
          <p className="text-center text-xs text-gray-400 mt-4">
            Al enviar este formulario aceptas nuestra política de tratamiento de datos personales.
          </p>
        </div>
      </form>
    </div>
  );
};

export default QuoteForm;
