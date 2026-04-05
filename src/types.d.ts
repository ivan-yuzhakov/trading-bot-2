declare module 'express-mysql-session' {
  import session from 'express-session';
  function MySQLStoreFactory(session: any): any;
  export default MySQLStoreFactory;
}
