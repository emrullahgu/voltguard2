'use strict';

// Real browser navigation to record forms/details, backed only by the caller's
// disposable authenticated PHP dataset. No navigator route injection is used.
const {randomUUID}=require('node:crypto');
const inventory=require('./employee-screen-inventory.cjs');

module.exports=async function officeRecordScenarios({page,workflow,check,report,ui}){
  const source=inventory(),routes=new Map(source.routes.map(route=>[route.route,route]));
  const host=ui.host;
  const stamp=new Date().toISOString();
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  async function openList(target){
    const queue=source.entries.filter(entry=>entry.enabled).map(entry=>({entry,path:[],route:entry.route})),seen=new Set();
    while(queue.length){
      const item=queue.shift();if(seen.has(item.route))continue;seen.add(item.route);
      if(item.route===target){await ui.open(item.entry.route);for(const edge of item.path)await ui.click(edge.label,edge.route);return;}
      for(const edge of routes.get(item.route)?.cards||[])if(!routes.get(edge.route)?.parameters?.required)queue.push({...item,route:edge.route,path:[...item.path,edge]});
    }
    throw Error('No parameter-free visible catalogue path: '+target);
  }
  async function cache(key,rows){await ui.cache(key,rows);}
  async function detail({name,parent,key,row,label,route,assertText}){
    await workflow('record-office:'+name,async()=>{
      await cache(key,[row]);await openList(parent);await ui.click(label,route);
      if(assertText)await host().getByText(assertText,{exact:true}).filter({visible:true}).first().waitFor({state:'visible'});
      await ui.inspect(route);
    });
  }

  await workflow('record-office:workspace',async()=>{
    await ui.seed('office_pages',[{id:randomUUID(),title:'QA Kalan Ofis Sayfası',icon:'📄',blocks:[{id:randomUUID(),type:'text',text:'QA sentetik sayfa içeriği'}],archived:false,is_favorite:false,order_index:1,created_at:stamp,updated_at:stamp}]);
    await ui.seed('office_boards',[{id:randomUUID(),title:'QA Kalan Ofis Panosu',icon:'📋',columns:[{id:randomUUID(),title:'QA kolon',cards:[]}],archived:false,created_at:stamp,updated_at:stamp}]);
    await ui.seed('office_meetings',[{id:randomUUID(),title:'QA Kalan Ofis Toplantısı',date:day,attendees:[],notes:'QA sentetik toplantı notu',action_items:[],created_at:stamp,updated_at:stamp}]);
    await openList('OfficePages');await ui.click('QA Kalan Ofis Sayfası','OfficePage');
    check(await host().getByPlaceholder('Adsız sayfa',{exact:true}).inputValue(),'QA Kalan Ofis Sayfası','Office detail loads the actual canonical page title');await ui.inspect('OfficePage');
    await openList('OfficeBoards');await ui.click('QA Kalan Ofis Panosu','OfficeBoard');await ui.inspect('OfficeBoard');
    await openList('OfficeMeetings');await ui.click('QA Kalan Ofis Toplantısı','OfficeMeeting');await ui.inspect('OfficeMeeting');
  });

  await workflow('record-office:reports',async()=>{
    const kpi={workOrdersTotal:3,workOrdersCompleted:2,workOrdersCancelled:0,workOrdersOpen:1,revenue:900,cost:400,profit:500,laborMinutes:120,customersTouched:1,quotesCreated:1,quotesAccepted:1,slaBreaches:0};
    await cache('@SahaTakip:reports',[{id:randomUUID(),period:'daily',startDate:day,endDate:day,generatedAt:stamp,kpi,byStatus:[{label:'QA Durum',value:2}],byEngineer:[{label:'QA Mühendis',value:900}],byCustomer:[{label:'QA Müşteri',value:900}]}]);
    await openList('Reports');
    await host().getByText('Günlük · '+day,{exact:true}).filter({visible:true}).first().click();await ui.settle('ReportDetail');
    await host().getByText('QA Mühendis',{exact:true}).filter({visible:true}).first().waitFor({state:'visible'});await ui.inspect('ReportDetail');
  });
  await detail({name:'product',parent:'ProductItems',key:'product_items_v1',row:{id:randomUUID(),code:'QA-RECORD-1',name:'QA Kalan Ürün',status:'in_stock',createdAt:stamp},label:'QA Kalan Ürün',route:'ProductItemDetail',assertText:'QA Kalan Ürün'});
  await detail({name:'weekly',parent:'WeeklyReports',key:'weekly_reports_v1',row:{id:randomUUID(),weekStart:day,weekEnd:day,totalImportKwh:100,totalExportKwh:10,peakDemandKw:12,createdAt:stamp},label:day+' — '+day,route:'WeeklyReportDetail'});
  await detail({name:'payroll',parent:'PayrollRuns',key:'payroll_runs_v1',row:{id:randomUUID(),employeeId:randomUUID(),employeeName:'QA Kalan Bordro',periodMonth:day.slice(0,7),daysWorked:30,overtimeHours:0,items:[],gross:50000,deductions:5000,net:45000,status:'draft',createdAt:stamp},label:'QA Kalan Bordro',route:'PayrollDetail',assertText:'QA Kalan Bordro'});
  await detail({name:'task',parent:'Tasks',key:'tasks_v1',row:{id:randomUUID(),title:'QA Kalan Görev',description:'QA kalıcı görev açıklaması',status:'todo',priority:'normal',createdAt:stamp,tags:[]},label:'QA Kalan Görev',route:'TaskDetail',assertText:'QA kalıcı görev açıklaması'});
  await workflow('record-office:calendar',async()=>{
    await cache('calendar_events_v1',[{id:randomUUID(),title:'QA Kalan Etkinlik',kind:'meeting',startAt:day+'T10:00:00+03:00',endAt:day+'T11:00:00+03:00',allDay:false,attendees:[],createdAt:stamp}]);
    await openList('Calendar');await ui.click('QA Kalan Etkinlik','CalendarEventDetail');await ui.inspect('CalendarEventDetail');
    await openList('Calendar');await ui.click('Ekle','CalendarEventForm');await ui.inspect('CalendarEventForm');
  });
  await detail({name:'crash',parent:'CrashReports',key:'crash_reports_v1',row:{id:randomUUID(),occurredAt:stamp,severity:'warning',message:'QA Kalan Hata Kaydı',handled:true,platform:'web'},label:'QA Kalan Hata Kaydı',route:'CrashReportDetail',assertText:'QA Kalan Hata Kaydı'});
  await detail({name:'feedback',parent:'Feedback',key:'feedback_entries_v1',row:{id:randomUUID(),createdAt:stamp,category:'bug',title:'QA Kalan Geri Bildirim',message:'QA sentetik geri bildirim açıklaması',status:'open'},label:'QA Kalan Geri Bildirim',route:'FeedbackDetail',assertText:'QA sentetik geri bildirim açıklaması'});
  await workflow('record-office:feedback-form',async()=>{await openList('Feedback');await ui.click('Yeni','FeedbackForm');await ui.inspect('FeedbackForm');});
  await detail({name:'department',parent:'Departments',key:'gov_departments_v1',row:{id:randomUUID(),name:'QA Kalan Departman',createdAt:stamp},label:'QA Kalan Departman',route:'DepartmentForm'});
  await detail({name:'region',parent:'Regions',key:'gov_regions_v1',row:{id:randomUUID(),name:'QA Kalan Bölge',code:'QA',cities:[],createdAt:stamp},label:'QA Kalan Bölge',route:'RegionForm'});
  await workflow('record-office:approval',async()=>{
    await ui.seed('approvals',[{id:randomUUID(),kind:'other',title:'QA Kalan Onay',description:'QA sentetik onay açıklaması',status:'pending',created_at:stamp,payload:{}}]);
    await openList('Approvals');await ui.click('QA Kalan Onay','ApprovalDetail');await host().getByText('QA sentetik onay açıklaması',{exact:true}).waitFor({state:'visible'});await ui.inspect('ApprovalDetail');
  });
  await detail({name:'audit',parent:'AuditLogV2',key:'gov_audit_v1',row:{id:randomUUID(),occurredAt:stamp,action:'create',resource:'customer',resourceId:'QA-AUDIT-1',actorName:'QA Denetçi',note:'QA sentetik denetim açıklaması'},label:'Oluştur · customer · QA-AUDIT-1',route:'AuditDetail'});
  await workflow('record-office:offline',async()=>{
    await cache('offline_ops_v1',[
      {id:randomUUID(),createdAt:stamp,kind:'note',resource:'work_order',resourceId:'QA-OFFLINE',payload:{note:'QA yerel taslak'},status:'pending',attempts:0,description:'QA Kalan Offline İşlem'},
      {id:randomUUID(),createdAt:stamp,kind:'note',resource:'work_order',resourceId:'QA-CONFLICT',payload:{note:'QA yerel sürüm'},conflictRemote:{note:'QA sunucu sürümü'},status:'conflict',attempts:1,description:'QA Kalan Çakışma'}
    ]);
    await openList('OfflineQueue');await ui.click('QA Kalan Offline İşlem','OfflineOpDetail');await ui.inspect('OfflineOpDetail');
    await openList('OfflineQueue');await ui.click('QA Kalan Çakışma','ConflictResolver');await host().getByText('Yerel (Offline)',{exact:true}).waitFor({state:'visible'});await ui.inspect('ConflictResolver');
  });
  await detail({name:'portal-user',parent:'PortalUsers',key:'cx_portal_users_v1',row:{id:randomUUID(),customerId:'QA-CUSTOMER',fullName:'QA Kalan Portal Kullanıcısı',email:'qa-portal@example.invalid',status:'invited',invitedAt:stamp,canViewQuotes:true,canViewWorkOrders:true,canViewReports:false,canApproveQuotes:false},label:'QA Kalan Portal Kullanıcısı',route:'PortalUserForm'});
  await workflow('record-office:share-link',async()=>{
    await cache('cx_share_links_v1',[{id:randomUUID(),token:randomUUID(),resource:'report',resourceId:'QA-REPORT',title:'QA Kalan Paylaşım',createdAt:stamp,opens:0,status:'active'}]);
    await openList('ShareLinks');await ui.click('QA Kalan Paylaşım','ShareLinkDetail');await ui.inspect('ShareLinkDetail');await ui.click('Düzenle','ShareLinkForm');await ui.inspect('ShareLinkForm');
  });
  await detail({name:'survey',parent:'SatisfactionSurveys',key:'cx_satisfaction_surveys_v1',row:{id:randomUUID(),customerId:'QA-SURVEY-CUSTOMER',sentAt:stamp,status:'sent'},label:'Müşteri QA-SURVEY-CUSTOMER',route:'SurveyDetail'});
  await detail({name:'auto-report',parent:'AutoReports',key:'cx_auto_reports_v1',row:{id:randomUUID(),name:'QA Kalan Otomatik Rapor',cadence:'monthly',reportKind:'summary',nextRunAt:stamp,enabled:true},label:'QA Kalan Otomatik Rapor',route:'AutoReportForm'});
  await workflow('record-office:tenants',async()=>{
    await cache('pf_tenants_v1',[{id:'qa-tenant',name:'QA Kalan Firma',plan:'starter',status:'trial',createdAt:stamp,memberCount:1,storageMb:0}]);
    await openList('Tenants');await ui.click('Üyeler','TenantMembers');await ui.inspect('TenantMembers');
    await openList('Tenants');await ui.click('Ayarlar','TenantSettings');await ui.inspect('TenantSettings');
    await openList('Tenants');
    // This specific source list ends in a single floating add control. Clicking
    // the visible control exercises its real event handler, rather than routing.
    await host().getByRole('button',{name:'Yeni firma ekle',exact:true}).filter({visible:true}).click();await ui.settle('TenantForm');await ui.inspect('TenantForm');
  });
  (report.recordLimitations||=[]).push({route:'CustomerNotificationPrefs',reason:'Registered detail requires customerId, but no source navigation reference exists outside registration/type declarations. No arbitrary route was injected.'});
};
