/* ── PDF EXPORT (jsPDF) — draws the last AI analysis result as a report ──
   Benchmarks/warn thresholds match the Colombia numbers in metrics.js'
   computeHealthScore(): overhead <65%, acceptance >65%, no-show <12%. */

function exportPDF(){
  if(!LAST_RESULT||!CURRENT_DATA.length)return;
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const W=210,M=18;
  let y=0;

  // helpers
  const C={teal:[0,212,170],dark:[13,17,23],surface:[22,27,34],text:[230,237,243],muted:[125,133,144],white:[255,255,255],amber:[227,179,65],red:[248,81,73],green:[63,185,80],blue:[56,139,253]};
  const rgb=(c)=>{doc.setTextColor(c[0],c[1],c[2]);};
  const fill=(c)=>{doc.setFillColor(c[0],c[1],c[2]);};
  const draw=(c)=>{doc.setDrawColor(c[0],c[1],c[2]);};

  const addPage=()=>{doc.addPage();y=18;};
  const checkY=(need=20)=>{if(y+need>280)addPage();};

  // ── HEADER BLOCK ──
  fill(C.dark);doc.rect(0,0,W,38,'F');
  // accent bar
  fill(C.teal);doc.rect(0,0,W,2.5,'F');
  const pracName=getWhiteLabel();
  // logo dot
  fill(C.teal);doc.circle(M,19,3,'F');
  rgb(C.white);doc.setFont('helvetica','bold');doc.setFontSize(16);
  doc.text(pracName,M+7,16);
  rgb(C.muted);doc.setFont('helvetica','normal');doc.setFontSize(9);
  doc.text('Dashboard de Inteligencia Dental',M+7,22);
  // right side
  const now=new Date().toLocaleDateString('es-CO',{month:'long',day:'numeric',year:'numeric'});
  rgb(C.muted);doc.setFontSize(8);
  doc.text('Generado el '+now,W-M,19,{align:'right'});

  y=46;

  // ── ANALYSIS PERIOD ──
  const data=CURRENT_DATA;
  const fmtM=mo=>new Date(mo+'-02').toLocaleDateString('es-CO',{month:'short',year:'numeric'});
  const period=data.length?`${fmtM(data[0].month)} – ${fmtM(data[data.length-1].month)}`:'-';
  rgb(C.muted);doc.setFont('helvetica','normal');doc.setFontSize(8.5);
  doc.text(`Período de análisis: ${period}  ·  ${data.length} meses de datos`,M,y);
  y+=8;

  // ── HEADLINE ──
  fill(C.surface);doc.roundedRect(M,y,W-M*2,18,2,2,'F');
  fill(C.teal);doc.rect(M,y,3,18,'F');
  rgb(C.teal);doc.setFont('helvetica','bold');doc.setFontSize(7.5);
  doc.text('HALLAZGO EJECUTIVO IA',M+7,y+5.5);
  rgb(C.text);doc.setFont('helvetica','bold');doc.setFontSize(10.5);
  const headLines=doc.splitTextToSize(LAST_RESULT.headline,W-M*2-14);
  doc.text(headLines,M+7,y+12);
  y+=18+(headLines.length-1)*5+6;

  // ── KPI GRID (2×4) ──
  const m=computeMetrics(data);
  const overheadRate=Math.round(m.overheadRate);
  const acceptRate=Math.round(m.acceptanceRate);
  const noShowRate=Math.round(m.noShowRate);

  const kpis=[
    {label:'Recaudación Total',val:'$'+(m.totalCollections/1e6).toFixed(1)+'M',sub:'Total del período'},
    {label:'Producción Bruta',val:'$'+(m.totalProduction/1e6).toFixed(1)+'M',sub:'Total del período'},
    {label:'Ingreso Neto',val:'$'+(m.totalNetIncome/1e6).toFixed(1)+'M',sub:m.totalCollections?Math.round(m.totalNetIncome/m.totalCollections*100)+'% margen':'-'},
    {label:'Tasa de Gastos',val:overheadRate+'%',sub:'Meta: <65%',warn:overheadRate>=65},
    {label:'Pacientes Nuevos',val:String(m.totalNewPat),sub:data.length?Math.round(m.avgNewPatPerMonth)+'/mes prom':'-'},
    {label:'Citas Completadas',val:String(m.totalCompleted),sub:m.totalScheduled?Math.round(m.totalCompleted/m.totalScheduled*100)+'% de lo agendado':'-'},
    {label:'Aceptación de Tratamientos',val:acceptRate+'%',sub:'Meta: >65%',warn:acceptRate<65},
    {label:'Tasa de Ausentismo',val:noShowRate+'%',sub:'Meta: <12%',warn:noShowRate>=12},
  ];

  checkY(30);
  const kW=(W-M*2-9)/4,kH=22;
  kpis.forEach((k,i)=>{
    const col=i%4,row=Math.floor(i/4);
    const kx=M+col*(kW+3),ky=y+row*(kH+4);
    fill(C.surface);doc.roundedRect(kx,ky,kW,kH,1.5,1.5,'F');
    // color top bar
    const barC=k.warn?C.red:C.teal;
    fill(barC);doc.rect(kx,ky,kW,1.5,'F');
    rgb(C.muted);doc.setFont('helvetica','normal');doc.setFontSize(6.5);
    doc.text(k.label.toUpperCase(),kx+4,ky+7);
    rgb(k.warn?C.amber:C.white);doc.setFont('helvetica','bold');doc.setFontSize(12);
    doc.text(k.val,kx+4,ky+15);
    rgb(C.muted);doc.setFont('helvetica','normal');doc.setFontSize(6);
    doc.text(k.sub,kx+4,ky+20);
  });
  y+=kH*2+4*3+10;

  // ── AI NARRATIVE BLOCKS ──
  checkY(12);
  rgb(C.muted);doc.setFont('helvetica','bold');doc.setFontSize(7.5);
  doc.text('ANÁLISIS EJECUTIVO',M,y);
  y+=5;
  draw(C.surface);doc.setLineWidth(0.2);doc.line(M,y,W-M,y);y+=5;

  const blocks=[
    {label:'Qué pasó',txt:LAST_RESULT.what_happened},
    {label:'Por qué importa',txt:LAST_RESULT.why_it_matters},
    {label:'Oportunidad / Riesgo',txt:LAST_RESULT.opportunity},
  ];
  const bW=(W-M*2-8)/3;
  let maxBH=0;
  const blockLayouts=blocks.map((b,i)=>{
    const lines=doc.splitTextToSize(b.txt,bW-8);
    const bH=14+lines.length*4.2;
    if(bH>maxBH)maxBH=bH;
    return{...b,lines,bH,bx:M+i*(bW+4)};
  });
  checkY(maxBH+4);
  blockLayouts.forEach(b=>{
    fill(C.surface);doc.roundedRect(b.bx,y,bW,maxBH,1.5,1.5,'F');
    fill(C.teal);doc.rect(b.bx,y,bW,1.5,'F');
    rgb(C.teal);doc.setFont('helvetica','bold');doc.setFontSize(6.5);
    doc.text(b.label.toUpperCase(),b.bx+4,y+8);
    rgb(C.text);doc.setFont('helvetica','normal');doc.setFontSize(8);
    doc.text(b.lines,b.bx+4,y+14);
  });
  y+=maxBH+8;

  // ── RECOMMENDED ACTIONS ──
  checkY(14);
  rgb(C.muted);doc.setFont('helvetica','bold');doc.setFontSize(7.5);
  doc.text('ACCIONES RECOMENDADAS',M,y);y+=5;
  draw(C.surface);doc.setLineWidth(0.2);doc.line(M,y,W-M,y);y+=5;

  const prioColors={URGENT:C.red,MEDIUM:C.amber,LOW:C.green};
  LAST_RESULT.actions.forEach(a=>{
    const lines=doc.splitTextToSize(a.text,W-M*2-28);
    const aH=Math.max(12,8+lines.length*4.5);
    checkY(aH+3);
    fill(C.surface);doc.roundedRect(M,y,W-M*2,aH,1.5,1.5,'F');
    const pc=prioColors[a.priority]||C.green;
    fill(pc);doc.roundedRect(M+3,y+aH/2-4,18,8,1,1,'F');
    rgb(C.dark);doc.setFont('helvetica','bold');doc.setFontSize(6);
    doc.text(a.priority,M+12,y+aH/2+1,{align:'center'});
    rgb(C.text);doc.setFont('helvetica','normal');doc.setFontSize(8.5);
    doc.text(lines,M+25,y+7);
    y+=aH+4;
  });

  // ── CONFIDENCE BAR ──
  y+=4;checkY(14);
  fill(C.surface);doc.roundedRect(M,y,W-M*2,12,1.5,1.5,'F');
  rgb(C.muted);doc.setFont('helvetica','normal');doc.setFontSize(7.5);
  doc.text('Confianza del análisis',M+4,y+8);
  const barW=W-M*2-70;
  fill([30,38,48]);doc.roundedRect(M+48,y+4.5,barW,3,1,1,'F');
  fill(C.teal);doc.roundedRect(M+48,y+4.5,barW*(LAST_RESULT.confidence/100),3,1,1,'F');
  rgb(C.teal);doc.setFont('helvetica','bold');doc.setFontSize(8);
  doc.text(LAST_RESULT.confidence+'%',W-M-4,y+8,{align:'right'});
  y+=16;

  // ── FOOTER ──
  const pages=doc.getNumberOfPages();
  for(let p=1;p<=pages;p++){
    doc.setPage(p);
    fill(C.dark);doc.rect(0,285,W,12,'F');
    fill(C.teal);doc.rect(0,285,W,0.8,'F');
    rgb(C.muted);doc.setFont('helvetica','normal');doc.setFontSize(7);
    doc.text(`${pracName} — Informe de Inteligencia de la Clínica`,M,291);
    doc.text(`Página ${p} de ${pages}`,W-M,291,{align:'right'});
  }

  doc.save(`SmileDental_Analisis_${new Date().toISOString().slice(0,10)}.pdf`);
}
